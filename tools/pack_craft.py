import numpy as np, cv2, json, base64, struct, sys
d=np.load('taxi_raw.npz'); P,N,UV,MAT,I=d['P'],d['N'],d['UV'],d['MAT'],d['I']
tri=I.reshape(-1,3); tm=MAT[tri[:,0]]
tri=tri[tm!=3]                                   # drop the interior
used=np.unique(tri); remap=-np.ones(len(P),np.int64); remap[used]=np.arange(len(used))
P=P[used]; N=N[used]; UV=UV[used]; MAT=MAT[used]; tri=remap[tri]
print('exterior: verts',len(P),'tris',len(tri))

# ---- bake textures at vertex UVs ----
def tex(path, srgb=True):
    im=cv2.imread('taxi/textures/'+path, cv2.IMREAD_UNCHANGED)
    if im.ndim==2: im=np.stack([im]*3,-1)
    im=im[:,:,:3][:,:,::-1].astype(np.float32)/255.0          # RGB
    return im
def sample(im, uv):
    h,w=im.shape[:2]
    u=np.mod(uv[:,0],1.0); v=np.mod(uv[:,1],1.0)
    x=np.clip((u*(w-1)).astype(int),0,w-1); y=np.clip((v*(h-1)).astype(int),0,h-1)
    return im[y,x]
col=np.zeros((len(P),3),np.float32); emi=np.zeros((len(P),3),np.float32)
rough=np.full(len(P),0.6,np.float32); metal=np.zeros(len(P),np.float32)
# Parts
m=MAT==0
col[m]=sample(tex('Parts_baseColor.png'),UV[m])
emi[m]=sample(tex('Parts_emissive.jpeg'),UV[m])
mr=sample(tex('Parts_metallicRoughness.png'),UV[m]); rough[m]=mr[:,1]; metal[m]=mr[:,2]
# BaseMaterial
m=MAT==1
col[m]=sample(tex('BaseMaterial_baseColor.jpeg'),UV[m])
mr=sample(tex('BaseMaterial_metallicRoughness.png'),UV[m]); rough[m]=mr[:,1]; metal[m]=mr[:,2]
# Glass
m=MAT==2
col[m]=[0.06,0.10,0.13]; rough[m]=0.04; metal[m]=0.0
print('emissive verts >0.2:',int((emi.max(1)>0.2).sum()),' mean colour',col.mean(0).round(3),' mean rough',rough.mean().round(2),' mean metal',metal.mean().round(2))

# ---- orient: model +Z is the nose -> our +X forward. rotate +90deg about Y ----
R=np.array([[0,0,1],[0,1,0],[-1,0,0]],dtype=np.float64)    # (x,y,z)->(z,y,-x)
P=(R@P.T).T; N=(R@N.T).T
mn,mx=P.min(0),P.max(0); ctr=(mn+mx)/2
P=P-ctr
SCALE=1.02; P*=SCALE
mn,mx=P.min(0),P.max(0); print('placed bounds',mn.round(2),mx.round(2))

# ---- vertex-cluster decimation, keyed by material so colours never bleed ----
target=int(sys.argv[1]) if len(sys.argv)>1 else 300
cell=(mx-mn).max()/target
key=np.floor((P-mn)/cell).astype(np.int64)
k=(key[:,0]*73856093 ^ key[:,1]*19349663 ^ key[:,2]*83492791) ^ (MAT.astype(np.int64)*2654435761)
uniq,inv=np.unique(k,return_inverse=True)
nV=len(uniq)
# average attributes into clusters
def avg(a):
    out=np.zeros((nV,)+a.shape[1:],np.float64); np.add.at(out,inv,a)
    cnt=np.zeros(nV); np.add.at(cnt,inv,1); return out/cnt[:,None] if a.ndim>1 else out/cnt
P2=avg(P); C2=avg(col); E2=avg(emi); R2=avg(rough); M2=avg(metal); MAT2=avg(MAT.astype(np.float64)).round().astype(np.int8)
t2=inv[tri]
t2=t2[(t2[:,0]!=t2[:,1])&(t2[:,1]!=t2[:,2])&(t2[:,0]!=t2[:,2])]
# drop duplicate faces
t2s=np.sort(t2,axis=1); _,fi=np.unique(t2s,axis=0,return_index=True); t2=t2[np.sort(fi)]
print(f'after clustering (cell {cell:.3f}): verts {nV}, tris {len(t2)}')

# ---- smooth normals from faces (area weighted) ----
fn=np.cross(P2[t2[:,1]]-P2[t2[:,0]], P2[t2[:,2]]-P2[t2[:,0]])
N2=np.zeros_like(P2)
for j in range(3): np.add.at(N2,t2[:,j],fn)
N2/=np.linalg.norm(N2,axis=1,keepdims=True)+1e-9
# keep original orientation sense where clustering flipped things
Nold=avg(N); flip=(N2*Nold).sum(1)<0; N2[flip]*=-1

# ---- chunk into <=65535-vertex groups for uint16 indices ----
chunks=[]; vmap=-np.ones(nV,np.int64); cur=[];curV=[];
def flush():
    global cur,curV,vmap
    if not cur: return
    chunks.append((np.array(curV,np.int64),np.array(cur,np.int64)))
    cur=[];curV=[]; vmap[:]=-1
for f in t2:
    need=[v for v in f if vmap[v]<0]
    if len(curV)+len(need)>65535: flush(); need=list(f)
    for v in need: vmap[v]=len(curV); curV.append(v)
    cur.append([vmap[v] for v in f])
flush()
print('chunks:',len(chunks),[len(c[0]) for c in chunks])

# ---- quantize + interleave: 20 bytes/vertex ----
# pos int16 x3 | pad int16 | nrm int8 x3 | metal u8 | col u8 x3 | rough u8 | emi u8 x3 | pad u8
bmin=P2.min(0); bmax=P2.max(0); span=np.maximum(bmax-bmin,1e-6)
out=bytearray(); idx_out=bytearray(); meta=[]
for verts,faces in chunks:
    vo=len(out)//20; io=len(idx_out)//2
    q=np.round((P2[verts]-bmin)/span*65535-32768).astype(np.int16)
    n8=np.clip(np.round(N2[verts]*127),-127,127).astype(np.int8)
    c8=np.clip(np.round(np.power(np.clip(C2[verts],0,1),1/2.2)*255),0,255).astype(np.uint8)   # store sRGB
    e8=np.clip(np.round(np.power(np.clip(E2[verts],0,1),1/2.2)*255),0,255).astype(np.uint8)
    r8=np.clip(np.round(R2[verts]*255),0,255).astype(np.uint8); m8=np.clip(np.round(M2[verts]*255),0,255).astype(np.uint8)
    rec=np.zeros((len(verts),20),np.uint8)
    rec[:,0:6]=q.view(np.uint8).reshape(-1,6);
    rec[:,8:11]=n8.view(np.uint8).reshape(-1,3); rec[:,11]=m8
    rec[:,12:15]=c8; rec[:,15]=r8
    rec[:,16:19]=e8
    out+=rec.tobytes()
    idx_out+=faces.astype(np.uint16).tobytes()
    meta.append({'vo':vo,'vn':len(verts),'io':io,'in':len(faces)*3})
hdr={'stride':20,'bmin':bmin.tolist(),'bmax':bmax.tolist(),'chunks':meta,'vbytes':len(out),'ibytes':len(idx_out),
     'credit':'VTOL Air Taxi by Annelida, CC-BY-4.0'}
blob=bytes(out)+bytes(idx_out)
b64=base64.b64encode(blob).decode()
open('craft.js','w').write('window.__CRAFT='+json.dumps({'hdr':hdr,'b64':b64})+';')
print(f'packed: {len(blob)/1e6:.2f} MB binary -> craft.js {len(b64)/1e6:.2f} MB')
np.savez('taxi_packed_preview.npz',P=P2,N=N2,C=C2,E=E2,T=t2)

"""Pack the building prototypes (Low-poly City Buildings, CC-BY smooth998) and the
megablock (Futuristic Urban Tower, CC-BY ztrztr3) into one bldg.js in the same 20-byte
vertex format the craft uses:  pos int16 x3 | pad | nrm int8 x3 | metal u8 | col u8 x3 (sRGB) | rough u8 | emi u8 x3 | pad
Units are metres after packing; each prototype is centred on its footprint with its base at y=0."""
import os
import numpy as np, cv2, json, base64, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from gltf2 import load

def tex(path):
    im=cv2.imread(path, cv2.IMREAD_UNCHANGED)
    if im.ndim==2: im=np.stack([im]*3,-1)
    return im[:,:,:3][:,:,::-1].astype(np.float32)/255.0
def sample(im,uv):
    h,w=im.shape[:2]; u=np.mod(uv[:,0],1.0); v=np.mod(uv[:,1],1.0)
    return im[np.clip((v*(h-1)).astype(int),0,h-1), np.clip((u*(w-1)).astype(int),0,w-1)]

def smooth_normals(P,tri,Nold=None):
    fn=np.cross(P[tri[:,1]]-P[tri[:,0]], P[tri[:,2]]-P[tri[:,0]])
    N=np.zeros_like(P)
    for j in range(3): np.add.at(N,tri[:,j],fn)
    N/=np.linalg.norm(N,axis=1,keepdims=True)+1e-9
    if Nold is not None:
        flip=(N*Nold).sum(1)<0; N[flip]*=-1
    return N

def cluster(P,N,C,E,tri,target):
    mn,mx=P.min(0),P.max(0); cell=(mx-mn).max()/target
    key=np.floor((P-mn)/cell).astype(np.int64)
    k=(key[:,0]*73856093 ^ key[:,1]*19349663 ^ key[:,2]*83492791)
    uniq,inv=np.unique(k,return_inverse=True); nV=len(uniq)
    def avg(a):
        out=np.zeros((nV,)+a.shape[1:],np.float64); np.add.at(out,inv,a)
        cnt=np.zeros(nV); np.add.at(cnt,inv,1); return out/cnt[:,None] if a.ndim>1 else out/cnt
    P2=avg(P); C2=avg(C); E2=avg(E); N0=avg(N)
    t2=inv[tri]; t2=t2[(t2[:,0]!=t2[:,1])&(t2[:,1]!=t2[:,2])&(t2[:,0]!=t2[:,2])]
    t2s=np.sort(t2,axis=1); _,fi=np.unique(t2s,axis=0,return_index=True); t2=t2[np.sort(fi)]
    N2=smooth_normals(P2,t2,N0)
    return P2,N2,C2,E2,t2

def pack(P,N,C,E,tri,rough=0.7,metal=0.0):
    """-> (hdr, bytes). Chunks into <=65535-vertex groups for uint16 indices."""
    nV=len(P); chunks=[]; vmap=-np.ones(nV,np.int64); cur=[];curV=[]
    def flush():
        nonlocal cur,curV
        if cur: chunks.append((np.array(curV,np.int64),np.array(cur,np.int64)))
        cur=[];curV=[]; vmap[:]=-1
    for f in tri:
        need=[v for v in f if vmap[v]<0]
        if len(curV)+len(need)>65535: flush(); need=list(f)
        for v in need: vmap[v]=len(curV); curV.append(v)
        cur.append([vmap[v] for v in f])
    flush()
    bmin=P.min(0); bmax=P.max(0); span=np.maximum(bmax-bmin,1e-6)
    out=bytearray(); idx_out=bytearray(); meta=[]
    for verts,faces in chunks:
        vo=len(out)//20; io=len(idx_out)//2
        q=np.round((P[verts]-bmin)/span*65535-32768).astype(np.int16)
        n8=np.clip(np.round(N[verts]*127),-127,127).astype(np.int8)
        c8=np.clip(np.round(np.power(np.clip(C[verts],0,1),1/2.2)*255),0,255).astype(np.uint8)
        e8=np.clip(np.round(np.power(np.clip(E[verts],0,1),1/2.2)*255),0,255).astype(np.uint8)
        rec=np.zeros((len(verts),20),np.uint8)
        rec[:,0:6]=q.view(np.uint8).reshape(-1,6)
        rec[:,8:11]=n8.view(np.uint8).reshape(-1,3); rec[:,11]=int(metal*255)
        rec[:,12:15]=c8; rec[:,15]=int(rough*255); rec[:,16:19]=e8
        out+=rec.tobytes(); idx_out+=faces.astype(np.uint16).tobytes()
        meta.append({'vo':vo,'vn':len(verts),'io':io,'in':len(faces)*3})
    hdr={'stride':20,'bmin':bmin.tolist(),'bmax':bmax.tolist(),'chunks':meta,'vbytes':len(out),'ibytes':len(idx_out)}
    return hdr, bytes(out)+bytes(idx_out)

protos=[]

# ---------------- the building pack ----------------
d=load('in/low-poly_city_buildings_1/scene.gltf')
P,N,UV,MAT,I,NODE=d['P'],d['N'],d['UV'],d['MAT'],d['I'],d['NODE']
tri=I.reshape(-1,3)
bc=tex('in/low-poly_city_buildings_1/textures/material_baseColor.jpeg')
col=np.zeros((len(P),3),np.float32); m=MAT==0; col[m]=sample(bc,UV[m])
SCALE_PACK=100.0
groups={}
for ni in np.unique(NODE):
    if ni==8: continue                       # the ground plane
    groups.setdefault(40 if ni==44 else ni,[]).append(ni)   # the roof cap belongs to Object_40
for key,members in sorted(groups.items()):
    vm=np.isin(NODE,members)
    tm=vm[tri[:,0]]
    t=tri[tm]; used=np.unique(t); remap=-np.ones(len(P),np.int64); remap[used]=np.arange(len(used))
    p=P[used]*SCALE_PACK; n=N[used]; c=col[used]; e=np.zeros_like(c); t=remap[t]
    mn,mx=p.min(0),p.max(0)
    p=p-np.array([(mn[0]+mx[0])/2, mn[1], (mn[2]+mx[2])/2])
    hdr,blob=pack(p,n,c,e,t,rough=0.75)
    hdr['name']='b%02d'%key; hdr['h']=float(mx[1]-mn[1]); hdr['w']=float(mx[0]-mn[0]); hdr['d']=float(mx[2]-mn[2]); hdr['tris']=int(len(t))
    protos.append((hdr,blob))
    print(hdr['name'],'tris',len(t),'h %.0f w %.0f d %.0f'%(hdr['h'],hdr['w'],hdr['d']))

# ---------------- the megablock ----------------
target=int(sys.argv[1]) if len(sys.argv)>1 else 200
d=np.load('tower_raw.npz')
P,N,C,I=d['P'].astype(np.float64),d['N'].astype(np.float64),d['COL'].astype(np.float64),d['I']
tri=I.reshape(-1,3)
hsv=cv2.cvtColor((np.clip(C,0,1)*255).astype(np.uint8).reshape(-1,1,3), cv2.COLOR_RGB2HSV).reshape(-1,3).astype(np.float64)
sat=hsv[:,1]/255; val=hsv[:,2]/255
emask=(sat>0.38)&(val>0.42)
E=np.where(emask[:,None], C, 0.0)
print('megablock emissive verts',int(emask.sum()),'of',len(P))
P2,N2,C2,E2,t2=cluster(P,N,C,E,tri,target)
SCALE_MEGA=75.0
P2=P2*SCALE_MEGA
mn,mx=P2.min(0),P2.max(0)
P2=P2-np.array([(mn[0]+mx[0])/2, mn[1], (mn[2]+mx[2])/2])
hdr,blob=pack(P2,N2,C2,E2,t2,rough=0.6,metal=0.15)
hdr['name']='mega'; hdr['h']=float(mx[1]-mn[1]); hdr['w']=float(mx[0]-mn[0]); hdr['d']=float(mx[2]-mn[2]); hdr['tris']=int(len(t2))
protos.append((hdr,blob))
print('mega tris',len(t2),'verts',len(P2),'h %.0f w %.0f d %.0f'%(hdr['h'],hdr['w'],hdr['d']), 'bytes',len(blob))
np.savez('mega_packed_preview.npz',P=P2,N=N2,C=C2,E=E2,T=t2)

out={'credit':['Low-poly City Buildings by smooth998, CC-BY-4.0','Futuristic Urban Tower by ztrztr3, CC-BY-4.0'],
     'protos':[{'hdr':h,'b64':base64.b64encode(b).decode()} for h,b in protos]}
s='window.__BLDG='+json.dumps(out)+';'
open('bldg.js','w').write(s)
print('bldg.js %.2f MB'%(len(s)/1e6))

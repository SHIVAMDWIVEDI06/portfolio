"""glTF loader v2: world-space soup with UVs, material index and node index per vertex."""
import json, os, numpy as np
CT={5120:np.int8,5121:np.uint8,5122:np.int16,5123:np.uint16,5125:np.uint32,5126:np.float32}
NC={'SCALAR':1,'VEC2':2,'VEC3':3,'VEC4':4,'MAT4':16}
def load(path):
    g=json.load(open(path)); base=os.path.dirname(path)
    bufs=[open(os.path.join(base,b['uri']),'rb').read() for b in g['buffers']]
    def acc(i):
        a=g['accessors'][i]; bv=g['bufferViews'][a['bufferView']]
        dt=CT[a['componentType']]; n=NC[a['type']]
        off=bv.get('byteOffset',0)+a.get('byteOffset',0); stride=bv.get('byteStride',0)
        cnt=a['count']; item=np.dtype(dt).itemsize*n; raw=bufs[bv['buffer']]
        if stride and stride!=item:
            arr=np.lib.stride_tricks.as_strided(np.frombuffer(raw,dtype=np.uint8,offset=off,count=stride*(cnt-1)+item),shape=(cnt,item),strides=(stride,1)).copy().view(dt).reshape(cnt,n)
        else: arr=np.frombuffer(raw,dtype=dt,count=cnt*n,offset=off).reshape(cnt,n)
        if a.get('normalized'): arr=arr.astype(np.float32)/np.iinfo(dt).max
        return arr
    def node_mat(nd):
        if 'matrix' in nd: return np.array(nd['matrix'],dtype=np.float64).reshape(4,4).T
        T=np.eye(4);R=np.eye(4);S=np.eye(4)
        if 'translation' in nd: T[:3,3]=nd['translation']
        if 'rotation' in nd:
            x,y,z,w=nd['rotation']
            R[:3,:3]=[[1-2*(y*y+z*z),2*(x*y-z*w),2*(x*z+y*w)],[2*(x*y+z*w),1-2*(x*x+z*z),2*(y*z-x*w)],[2*(x*z-y*w),2*(y*z+x*w),1-2*(x*x+y*y)]]
        if 'scale' in nd: S[0,0],S[1,1],S[2,2]=nd['scale']
        return T@R@S
    P=[];N=[];UV=[];MAT=[];I=[];NODE=[]; voff=0
    def visit(ni,parent):
        nonlocal voff
        nd=g['nodes'][ni]; m=parent@node_mat(nd)
        if 'mesh' in nd:
            for prim in g['meshes'][nd['mesh']]['primitives']:
                if prim.get('mode',4)!=4: continue
                pos=acc(prim['attributes']['POSITION']).astype(np.float64); cnt=len(pos)
                w=(m[:3,:3]@pos.T).T+m[:3,3]
                if 'NORMAL' in prim['attributes']:
                    nr=acc(prim['attributes']['NORMAL']).astype(np.float64); nm=np.linalg.inv(m[:3,:3]).T
                    wn=(nm@nr.T).T; wn/=np.linalg.norm(wn,axis=1,keepdims=True)+1e-9
                else: wn=np.zeros_like(w)
                uv=acc(prim['attributes']['TEXCOORD_0']).astype(np.float32) if 'TEXCOORD_0' in prim['attributes'] else np.zeros((cnt,2),np.float32)
                idx=acc(prim['indices']).astype(np.int64).ravel() if 'indices' in prim else np.arange(cnt)
                P.append(w);N.append(wn);UV.append(uv);I.append(idx+voff)
                MAT.append(np.full(cnt,prim.get('material',-1),np.int32)); NODE.append(np.full(cnt,ni,np.int32))
                voff+=cnt
        for c in nd.get('children',[]): visit(c,m)
    for r in g['scenes'][g.get('scene',0)]['nodes']: visit(r,np.eye(4))
    return dict(P=np.concatenate(P),N=np.concatenate(N),UV=np.concatenate(UV),MAT=np.concatenate(MAT),I=np.concatenate(I),NODE=np.concatenate(NODE),g=g)

"""Quick software rasteriser: flat-shaded triangles from a fixed camera, for checking models."""
import numpy as np, cv2, sys
def render(P,tri,col,out,size=(900,700),yaw=0.6,pitch=0.35,zoom=1.0,bg=(20,18,16)):
    P=P-(P.min(0)+P.max(0))/2; s=np.abs(P).max(); P=P/s
    cy,sy=np.cos(yaw),np.sin(yaw); cp,sp=np.cos(pitch),np.sin(pitch)
    R1=np.array([[cy,0,sy],[0,1,0],[-sy,0,cy]]); R2=np.array([[1,0,0],[0,cp,-sp],[0,sp,cp]])
    V=(R2@R1@P.T).T
    W,H=size; f=0.42*min(W,H)*zoom
    z=V[:,2]+3.0
    x=W/2+V[:,0]/z*f*3; y=H/2-V[:,1]/z*f*3
    img=np.full((H,W,3),bg,np.uint8); zb=np.full((H,W),1e9)
    a,b,c=P[tri[:,0]],P[tri[:,1]],P[tri[:,2]]
    n=np.cross(b-a,c-a); n/=np.linalg.norm(n,axis=1,keepdims=True)+1e-9
    L=np.array([0.4,0.8,0.45]); L/=np.linalg.norm(L)
    lit=np.clip(n@L,0,1)*0.75+0.35
    depth=(z[tri[:,0]]+z[tri[:,1]]+z[tri[:,2]])/3
    order=np.argsort(-depth)
    fc=np.clip(col*lit[:,None],0,1)
    for i in order:
        pts=np.array([[x[tri[i,0]],y[tri[i,0]]],[x[tri[i,1]],y[tri[i,1]]],[x[tri[i,2]],y[tri[i,2]]]],np.int32)
        cc=fc[i]; cv2.fillConvexPoly(img,pts,(int(cc[2]*255),int(cc[1]*255),int(cc[0]*255)),lineType=cv2.LINE_AA)
    cv2.imwrite(out,img)

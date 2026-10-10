
/* ==================================================================
   5. THE SURVEY — a five-act flight, rendered in hand-written WebGL.
      Solid lit geometry throughout: a shaded terrain, a tiered neon
      city with skyways and air traffic, and a flying craft you chase
      from behind. No library, no assets, nothing downloaded.

        I   TRANSECT  survey the ground, four project stations
        II  PICKUP    a craft drops out of the sky and waits for you
        III FLIGHT    airborne, the city rising ahead
        IV  CITY      threading the towers
        V   ASCENT    up the face of the building
   ================================================================== */
const SV = (function(){
  const root  = document.getElementById('survey');
  const boot  = document.getElementById('sv-boot');
  const hudEl = root.querySelector('.sv-hud');
  const hud = {
    elev:document.getElementById('sv-elev'), hdg:document.getElementById('sv-hdg'),
    fill:document.getElementById('sv-fill'), head:document.getElementById('sv-headmark'),
    pct:document.getElementById('sv-pct'),   station:document.getElementById('sv-station'),
    bar:document.getElementById('sv-bar'),   end:document.getElementById('sv-end'),
    play:document.getElementById('sv-play'), pts:document.getElementById('sv-pts'),
    act:document.getElementById('sv-act')
  };

  let built=false, running=false, raf=null, failed=false;
  let gl=null, progS=null, progP=null, progL=null, progSky=null, progB=null, progT=null;
  let t=0, tTarget=0, playing=false, lastT=0;
  let holdUntil=0, autoLeaveAt=0;
  const STATION_HOLD=4200, AUTO_LEAVE=5000, STATION_LEAD=0.032;   // the hold happens this far before the station, with the board in view
  const stations=[], floors=[];
  let ground, gpts, city, cityWin, neon, skyways, stars, pylons, cats, rover;
  let heroBands, streets, roof, traffic, flyer, flyLoc, thrust, neonGlow, stationSolid=null;
  let skyQuad=null;
  /* real assets published beside the page; every one has a procedural fallback */
  const ASSET={sky:null,envD:null,envS:null,craft:null,bldg:null,gDry:null,gRock:null};
  let texGDry=null,texGRock=null,extAniso=null,useModelsHero=false;
  let texSky=null,texEnvD=null,texEnvS=null,progC=null,craftGL=null;

  const ACT=[
    {k:'transect',a:0.00,b:0.40,name:'Open ground',sub:'Four stations, one for each project'},
    {k:'pickup',  a:0.40,b:0.58,name:'Pickup',     sub:'The air taxi comes down to meet you'},
    {k:'flight',  a:0.58,b:0.75,name:'Flight',     sub:'Low over the ground, towards the lights'},
    {k:'city',    a:0.75,b:0.88,name:'City',       sub:'Between the towers'},
    {k:'ascent',  a:0.88,b:1.01,name:'The tower',  sub:'Five floors, one for each part of the page'}
  ];
  const titleEl={ w:document.getElementById('sv-title'), k:document.getElementById('sv-title-k'), t:document.getElementById('sv-title-t'), s:document.getElementById('sv-title-s') };
  let titleAct=null, titleTimer=null;
  function showTitle(act,ms){
    if(!titleEl.w) return;
    titleEl.k.textContent='Act '+(ACT.indexOf(act)+1)+' of '+ACT.length;
    titleEl.t.textContent=act.name; titleEl.s.textContent=act.sub;
    titleEl.w.classList.add('on');
    clearTimeout(titleTimer); titleTimer=setTimeout(()=>titleEl.w.classList.remove('on'),ms||2600);
  }
  const actAt=v=>ACT.find(x=>v>=x.a&&v<x.b)||ACT[ACT.length-1];
  const sm=(a,b,x)=>{const u=Math.min(1,Math.max(0,(x-a)/(b-a)));return u*u*(3-2*u);};
  const lerp=(a,b,u)=>a+(b-a)*u;
  const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));

  const CITY={x:1520,z:-470,r:330,y:0};
  const HERO={x:1545,z:-505,h:270};

  function H(x,z){
    let v=0,a=1,f=0.0075;
    for(let i=0;i<4;i++){
      v+=a*Math.sin(x*f+Math.cos(z*f*1.3)*2.1)*Math.cos(z*f*0.9+Math.sin(x*f*1.1)*1.7);
      a*=0.5; f*=2.15;
    }
    v=v*11+Math.sin(x*0.0022)*7-Math.cos(z*0.0026)*5;
    const d=Math.hypot(x-CITY.x,z-CITY.z);
    return v*(1-sm(CITY.r*1.7,CITY.r*0.85,d))+CITY.y*sm(CITY.r*1.7,CITY.r*0.85,d);
  }
  function normalAt(x,z){
    const e=2.0, hx=H(x+e,z)-H(x-e,z), hz=H(x,z+e)-H(x,z-e);
    const nx=-hx, ny=2*e, nz=-hz, l=Math.hypot(nx,ny,nz)||1;
    return [nx/l,ny/l,nz/l];
  }

  const RAW=[
    [-300,270],[-250,215],[-185,160],[-120,112],[-52,66],[16,18],
    [86,-30],[156,-78],[228,-128],[300,-176],[372,-222],
    [500,-282],[660,-330],[850,-372],[1060,-410],[1250,-440],
    [1372,-458],[1448,-470],[1496,-482],[1524,-496],[1542,-512]
  ];
  const WAY=RAW.map(([x,z])=>[x,0,z]);
  function curveAt(u){
    const n=WAY.length-1;
    let s=clamp(u,0,0.9999)*n;
    const i=Math.min(Math.floor(s),n-1); s-=i;
    const p0=WAY[Math.max(0,i-1)],p1=WAY[i],p2=WAY[i+1],p3=WAY[Math.min(n,i+2)];
    const s2=s*s,s3=s2*s,o=[0,0,0];
    for(let k=0;k<3;k++)
      o[k]=0.5*((2*p1[k])+(-p0[k]+p2[k])*s+(2*p0[k]-5*p1[k]+4*p2[k]-p3[k])*s2+(-p0[k]+3*p1[k]-3*p2[k]+p3[k])*s3);
    return o;
  }
  function basisAt(u){
    const c=curveAt(u), n=curveAt(Math.min(1,u+0.0025));
    let dx=n[0]-c[0],dz=n[2]-c[2];
    const l=Math.hypot(dx,dz)||1; dx/=l; dz/=l;
    return {c,f:[dx,dz],r:[-dz,dx]};
  }
  /* how high the craft flies at a given point in the story */
  function altAt(v){
    if(v<0.40) return 17;
    if(v<0.58) return lerp(17, 46, sm(0.44,0.58,v));
    if(v<0.75) return lerp(46, 96, sm(0.58,0.75,v));
    return lerp(96, 74, sm(0.75,0.84,v));
  }

  const SUN=(()=>{const v=[-0.62,0.085,0.78];const l=Math.hypot(...v);return v.map(x=>x/l);})();
  const SUNC=[0.72,0.31,0.15];
  const SKYC=[0.115,0.128,0.190];
  const FOGC=[0.075,0.058,0.062];
  const CITYC=[1.00,0.55,0.25];
  const NEAR=30, FAR=900;

  /* ---------- shaders ---------- */
  const SKY_V=`
    attribute vec2 aP;
    uniform vec3 uF,uR,uU; uniform float uTx,uTy;
    varying vec3 vRay;
    void main(){ vRay=normalize(uF+uR*aP.x*uTx+uU*aP.y*uTy); gl_Position=vec4(aP,0.9999,1.0); }`;
  const EQ=`vec2 eqUV(vec3 d){ return vec2(0.5+atan(d.z,d.x)/6.2831853, 0.5-asin(clamp(d.y,-1.0,1.0))/3.14159265); }`;
  const SKY_F=EQ+`
    uniform vec3 uHor,uMid,uZen,uGround,uGlow,uCityDir; uniform float uGlowI,uHasSky;
    uniform sampler2D uSky;
    varying vec3 vRay;
    void main(){
      vec3 r=normalize(vRay); float h=r.y;
      vec3 c=mix(uHor,uMid,smoothstep(-0.01,0.22,h));
      c=mix(c,uZen,smoothstep(0.16,0.72,h));
      if(uHasSky>0.5){ c=texture2D(uSky,eqUV(r)).rgb*mix(1.0,0.70,smoothstep(0.08,0.65,h)); }
      vec3 fl=normalize(vec3(r.x,0.0,r.z));
      float b=max(dot(fl,uCityDir),0.0);
      c += uGlow*uGlowI*pow(b,5.0)*exp(-max(h,0.0)*6.0);
      c += uGlow*0.22*exp(-abs(h)*34.0)*pow(b,2.4);
      c = mix(uGround,c,smoothstep(uHasSky>0.5?-0.06:-0.16,0.012,h));
      gl_FragColor=vec4(c,1.0);
    }`;
  const S_V=`
    attribute vec3 aPos,aNrm,aCol;
    uniform mat4 uMVP; uniform vec3 uCam;
    varying vec3 vN,vC,vP; varying float vD;
    void main(){ vN=aNrm; vC=aCol; vP=aPos; vD=distance(aPos,uCam); gl_Position=uMVP*vec4(aPos,1.0); }`;
  const S_F=EQ+`
    uniform vec3 uCam,uSun,uSunC,uSkyC,uFog,uCityP,uCityC;
    uniform float uNear,uFar,uCityI,uSpec,uEmit,uEnvI,uReflI,uHasEnv,uHasG,uGScale;
    uniform sampler2D uEnvD,uEnvS,uG0,uG1;
    varying vec3 vN,vC,vP; varying float vD;
    void main(){
      vec3 N=normalize(vN), V=normalize(uCam-vP);
      vec3 bc=vC;
      if(uHasG>0.5){
        /* photographic ground: dry earth on the flats, rock where it steepens, a macro sample breaks the tiling */
        vec2 uv=vP.xz*uGScale;
        vec3 t0=pow(texture2D(uG0,uv).rgb,vec3(2.2));
        vec3 t1=pow(texture2D(uG1,uv*1.31+vec2(0.37,0.11)).rgb,vec3(2.2));
        vec3 m0=pow(texture2D(uG0,uv*0.061).rgb,vec3(2.2));
        vec3 m1=pow(texture2D(uG1,uv*0.043+vec2(0.5)).rgb,vec3(2.2));
        float slope=1.0-N.y;
        float w=smoothstep(0.28,0.60, m1.r*2.2+slope*4.0);
        vec3 tex=mix(t0,t1,w)*(0.55+1.4*m0.g);
        float e=clamp(vC.g*5.2,0.55,1.35);
        bc=tex*vec3(1.0,0.94,0.86)*2.4*e;
      }
      vec3 amb = uSkyC*(0.40+0.60*max(N.y,0.0));
      if(uHasEnv>0.5) amb = pow(texture2D(uEnvD,eqUV(N)).rgb,vec3(2.2))*uEnvI;
      vec3 lit=bc*(uSunC*max(dot(N,uSun),0.0)+amb);
      if(uHasEnv>0.5){
        float ndv=max(dot(N,V),0.0);
        float F=0.04+0.96*pow(1.0-ndv,5.0);
        vec3 R=reflect(-V,N);
        lit += pow(texture2D(uEnvS,eqUV(R),2.0).rgb,vec3(2.2))*F*uReflI;
      }
      vec3 tc=uCityP-vP; float cd=length(tc);
      lit += bc*uCityC*uCityI*max(dot(N,tc/cd),0.0)/(1.0+cd*cd*0.000020);
      lit += uSunC*pow(max(dot(N,normalize(uSun+V)),0.0),46.0)*uSpec;
      lit += bc*uEmit + bc*uHasG*0.52*vec3(0.92,0.92,1.0);
      float f=1.0-clamp((vD-uNear)/(uFar-uNear),0.0,1.0);
      gl_FragColor=vec4(mix(uFog,lit,f),1.0);
    }`;
  /* the city: same lighting as the solids, plus a facade model — window grid in world space,
     street light pooling at the base, dark floors, a soft sky rim. aInfo = (seed, baseY, topY);
     seed < 0 means no windows (the megablock keeps its baked panels), seed >= 2 is the tower. */
  const B_V=`
    attribute vec3 aPos,aNrm,aCol,aInfo; attribute vec2 aCtr;
    uniform mat4 uMVP; uniform vec3 uCam;
    varying vec3 vN,vC,vP,vI; varying vec2 vX; varying float vD;
    void main(){ vN=aNrm; vC=aCol; vP=aPos; vI=aInfo; vX=aCtr; vD=distance(aPos,uCam); gl_Position=uMVP*vec4(aPos,1.0); }`;
  const B_F=(aa)=>(aa?'#extension GL_OES_standard_derivatives : enable\n':'')+EQ+`
    uniform vec3 uCam,uSun,uSunC,uSkyC,uFog,uCityP,uCityC;
    uniform float uNear,uFar,uCityI,uEnvI,uReflI,uHasEnv,uTime;
    uniform sampler2D uEnvD,uEnvS;
    varying vec3 vN,vC,vP,vI; varying vec2 vX; varying float vD;
    /* integer-input hash: the varyings that feed it are floored first, so ulp noise cannot reach it */
    float h21(vec2 p){ p=floor(p); vec3 q=fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973)); q+=dot(q,q.yzx+33.33); return fract((q.x+q.y)*q.z); }
    void main(){
      vec3 N=normalize(vN), V=normalize(uCam-vP);
      float hgt=max(1.0,vI.z-vI.y), rel=clamp((vP.y-vI.y)/hgt,0.0,1.0);
      vec3 amb = uSkyC*(0.40+0.60*max(N.y,0.0));
      if(uHasEnv>0.5) amb = pow(texture2D(uEnvD,eqUV(N)).rgb,vec3(2.2))*uEnvI;
      vec3 lit=vC*(uSunC*max(dot(N,uSun),0.0)+amb);
      float ndv=max(dot(N,V),0.0);
      if(uHasEnv>0.5){ float F=0.04+0.96*pow(1.0-ndv,5.0); lit += pow(texture2D(uEnvS,eqUV(reflect(-V,N)),3.0).rgb,vec3(2.2))*F*uReflI; }
      vec3 tc=uCityP-vP; float cd=length(tc);
      lit += vC*uCityC*uCityI*max(dot(N,tc/cd),0.0)/(1.0+cd*cd*0.000020);
      /* street light pooling up the lower floors */
      lit += vC*vec3(1.0,0.60,0.30)*0.9*exp(-(vP.y-vI.y)/16.0)*(1.0-abs(N.y));
      /* sky rim on the edges */
      lit += pow(1.0-ndv,4.0)*uSkyC*0.55*(0.4+0.6*rel);
      if(vI.x>=0.0 && abs(N.y)<0.5){
        /* the facade tangent must be exact per face — interpolated normals would smear the grid */
        ${aa?'vec3 Ng=normalize(cross(dFdx(vP),dFdy(vP))); vec2 tg=normalize(vec2(-Ng.z,Ng.x));'
            :'float an=floor(atan(N.x,-N.z)*20.3718+0.5)/20.3718; vec2 tg=vec2(sin(an),cos(an));'}
        float u=dot(vP.xz-vX,tg);      /* measured from the building's own centre, so precision holds */
        vec2 g=vec2(u/3.1,(vP.y-vI.y)/3.8);
        vec2 cell=floor(g), f=fract(g);
        float seed=floor((vI.x>=2.0?vI.x-2.0:vI.x)*4096.0);
        float r=h21(cell+seed);
        float darkFloor=step(0.80,h21(vec2(cell.y+seed,seed*0.37+91.0)));
        float on=step(0.50,r)*(1.0-darkFloor)*(vI.x>=2.0?1.0-step(0.84,rel):1.0);   /* the tower's spire stays dark */
        float br=0.45+0.55*h21(cell+vec2(31.0,17.0)+seed*3.0);
        vec3 wc = vI.x>=2.0 ? vec3(0.50,0.92,0.84) : (r>0.94? vec3(0.60,0.82,1.0) : (r>0.89? vec3(0.66,0.92,0.86) : vec3(1.0,0.74,0.44)));
        ${aa?'vec2 w=fwidth(g)*1.2;':'vec2 w=vec2(0.02);'}
        float inW=smoothstep(0.16-w.x,0.16+w.x,f.x)*(1.0-smoothstep(0.80-w.x,0.80+w.x,f.x))
                 *smoothstep(0.20-w.y,0.20+w.y,f.y)*(1.0-smoothstep(0.82-w.y,0.82+w.y,f.y));
        float farMix=smoothstep(500.0,1500.0,vD);
        float flick=0.94+0.06*sin(uTime*0.0021+r*37.0);
        float win=mix(inW*on*br, 0.62*0.36*0.62, farMix);   /* far away the grid averages out */
        lit += wc*win*1.25*flick*(0.55+0.45*(1.0-rel*0.5));
        lit += wc*on*br*0.10*(1.0-farMix);                   /* spill onto the wall around a lit window */
      }
      float f=1.0-clamp((vD-uNear)/(uFar-uNear),0.0,1.0);
      gl_FragColor=vec4(mix(uFog,lit,f),1.0);
    }`;
  const P_V=`
    attribute vec3 aPos,aCol; attribute float aSize;
    uniform mat4 uMVP; uniform vec3 uCam,uOff; uniform float uMax;
    varying vec3 vC; varying float vD;
    void main(){
      vec3 p=aPos+uOff; vC=aCol; vD=distance(p,uCam);
      gl_Position=uMVP*vec4(p,1.0);
      gl_PointSize=min(aSize*(330.0/max(3.0,vD)),uMax);
    }`;
  const P_F=`
    uniform float uNear,uFar,uBoost,uAlpha,uSoft; uniform vec3 uFog;
    varying vec3 vC; varying float vD;
    void main(){
      float d=length(gl_PointCoord-0.5);
      if(d>0.5) discard;
      float a=pow(smoothstep(0.5,0.0,d),uSoft);
      float f=1.0-clamp((vD-uNear)/(uFar-uNear),0.0,1.0);
      gl_FragColor=vec4(mix(uFog,vC*uBoost,f),a*f*uAlpha);
    }`;
  const L_V=`
    attribute vec3 aPos; uniform mat4 uMVP; uniform vec3 uCam;
    varying float vD;
    void main(){ vD=distance(aPos,uCam); gl_Position=uMVP*vec4(aPos,1.0); }`;
  const L_F=`
    uniform float uNear,uFar,uAlpha,uNF; uniform vec3 uCol,uFog;
    varying float vD;
    void main(){
      float f=1.0-clamp((vD-uNear)/(uFar-uNear),0.0,1.0);
      gl_FragColor=vec4(mix(uFog,uCol,f),f*uAlpha*smoothstep(uNF*0.12,uNF,vD));
    }`;

  /* textured, self-lit quads: the station boards */
  const T_V=`
    attribute vec3 aPos; attribute vec2 aUV;
    uniform mat4 uMVP; uniform vec3 uCam;
    varying vec2 vUV; varying float vD;
    void main(){ vUV=aUV; vD=distance(aPos,uCam); gl_Position=uMVP*vec4(aPos,1.0); }`;
  const T_F=`
    uniform sampler2D uTex; uniform float uAlpha,uNear,uFar,uGlow; uniform vec3 uFog;
    varying vec2 vUV; varying float vD;
    void main(){
      vec4 c=texture2D(uTex,vUV);
      float f=1.0-clamp((vD-uNear)/(uFar-uNear),0.0,1.0);
      gl_FragColor=vec4(mix(uFog,c.rgb*uGlow,f), c.a*uAlpha*f);
    }`;

  /* the packed craft: 20-byte interleaved vertices, baked colour/emissive/roughness */
  const C_V=`
    attribute vec3 aPos,aNrm,aCol,aEmi; attribute float aMet,aRough;
    uniform mat4 uMVP,uModel; uniform vec3 uCam,uBmin,uSpan;
    varying vec3 vN,vP,vC,vE; varying float vR,vM,vD;
    void main(){
      vec3 lp=(aPos+32768.0)/65535.0*uSpan+uBmin;
      vec4 wp=uModel*vec4(lp,1.0);
      vP=wp.xyz; vN=mat3(uModel)*aNrm; vC=aCol; vE=aEmi; vR=aRough; vM=aMet;
      vD=distance(wp.xyz,uCam);
      gl_Position=uMVP*wp;
    }`;
  const C_F=EQ+`
    uniform vec3 uCam,uSun,uSunC,uFog,uCityP,uCityC;
    uniform float uNear,uFar,uCityI,uEmitI,uEnvI,uReflI;
    uniform sampler2D uEnvD,uEnvS;
    varying vec3 vN,vP,vC,vE; varying float vR,vM,vD;
    void main(){
      vec3 N=normalize(vN), V=normalize(uCam-vP);
      vec3 alb=pow(vC,vec3(2.2));
      float rough=clamp(vR,0.05,1.0), metal=vM;
      vec3 F0=mix(vec3(0.04),alb,metal);
      float ndv=max(dot(N,V),0.0);
      vec3 F=F0+(1.0-F0)*pow(1.0-ndv,5.0);
      vec3 dif=alb*(1.0-metal);
      float ndl=max(dot(N,uSun),0.0);
      float sp=pow(max(dot(N,normalize(uSun+V)),0.0), mix(180.0,6.0,rough));
      vec3 lit=dif*uSunC*ndl + uSunC*F*sp*(1.0-rough);
      lit += dif*pow(texture2D(uEnvD,eqUV(N)).rgb,vec3(2.2))*uEnvI;
      vec3 R=reflect(-V,N);
      lit += pow(texture2D(uEnvS,eqUV(R),rough*5.0).rgb,vec3(2.2))*F*(1.0-rough*0.8)*uReflI;
      vec3 tc=uCityP-vP; float cd=length(tc);
      lit += dif*uCityC*uCityI*max(dot(N,tc/cd),0.0)/(1.0+cd*cd*0.00002);
      lit += pow(vE,vec3(2.2))*uEmitI;
      float f=1.0-clamp((vD-uNear)/(uFar-uNear),0.0,1.0);
      gl_FragColor=vec4(mix(uFog,lit,f),1.0);
    }`;

  /* ---------- plumbing ---------- */
  function persp(fovy,asp,n,f){const q=1/Math.tan(fovy/2),nf=1/(n-f);
    return new Float32Array([q/asp,0,0,0, 0,q,0,0, 0,0,(f+n)*nf,-1, 0,0,2*f*n*nf,0]);}
  function look(e,c,up){
    let zx=e[0]-c[0],zy=e[1]-c[1],zz=e[2]-c[2];
    let l=Math.hypot(zx,zy,zz)||1; zx/=l;zy/=l;zz/=l;
    let xx=up[1]*zz-up[2]*zy,xy=up[2]*zx-up[0]*zz,xz=up[0]*zy-up[1]*zx;
    l=Math.hypot(xx,xy,xz)||1; xx/=l;xy/=l;xz/=l;
    const yx=zy*xz-zz*xy,yy=zz*xx-zx*xz,yz=zx*xy-zy*xx;
    return {m:new Float32Array([xx,yx,zx,0, xy,yy,zy,0, xz,yz,zz,0,
      -(xx*e[0]+xy*e[1]+xz*e[2]),-(yx*e[0]+yy*e[1]+yz*e[2]),-(zx*e[0]+zy*e[1]+zz*e[2]),1]),
      f:[-zx,-zy,-zz],r:[xx,xy,xz],u:[yx,yy,yz]};
  }
  function mul(a,b){const o=new Float32Array(16);
    for(let i=0;i<4;i++)for(let j=0;j<4;j++)
      o[i*4+j]=a[j]*b[i*4]+a[4+j]*b[i*4+1]+a[8+j]*b[i*4+2]+a[12+j]*b[i*4+3];
    return o;}
  let PREC='precision highp float;\n';
  function csh(t2,s){const o=gl.createShader(t2);gl.shaderSource(o,PREC+s);gl.compileShader(o);
    return gl.getShaderParameter(o,gl.COMPILE_STATUS)?o:null;}
  function prog(v,f,at,un){
    const a=csh(gl.VERTEX_SHADER,v),b=csh(gl.FRAGMENT_SHADER,f);
    if(!a||!b) return null;
    const p=gl.createProgram();gl.attachShader(p,a);gl.attachShader(p,b);gl.linkProgram(p);
    if(!gl.getProgramParameter(p,gl.LINK_STATUS)) return null;
    const o={p,a:{},u:{}};
    at.forEach(n=>o.a[n]=gl.getAttribLocation(p,n));
    un.forEach(n=>o.u[n]=gl.getUniformLocation(p,n));
    return o;
  }
  function buf(d,tp){const b=gl.createBuffer(),tg=tp||gl.ARRAY_BUFFER;
    gl.bindBuffer(tg,b);gl.bufferData(tg,d,gl.STATIC_DRAW);return b;}
  function dynb(n){const b=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,b);
    gl.bufferData(gl.ARRAY_BUFFER,n*4,gl.DYNAMIC_DRAW);return b;}
  function up(b,a){gl.bindBuffer(gl.ARRAY_BUFFER,b);gl.bufferSubData(gl.ARRAY_BUFFER,0,a);}

  function drawSolid(o,count,opt){
    const s=progS; gl.useProgram(s.p);
    gl.uniformMatrix4fv(s.u.uMVP,false,opt.mvp);
    gl.uniform3fv(s.u.uCam,opt.cam);
    gl.uniform3fv(s.u.uSun,SUN); gl.uniform3fv(s.u.uSunC,SUNC);
    gl.uniform3fv(s.u.uSkyC,SKYC); gl.uniform3fv(s.u.uFog,FOGC);
    gl.uniform3fv(s.u.uCityP,[CITY.x,CITY.y+80,CITY.z]); gl.uniform3fv(s.u.uCityC,CITYC);
    gl.uniform1f(s.u.uNear,opt.near==null?NEAR:opt.near);
    gl.uniform1f(s.u.uFar,opt.far==null?FAR:opt.far);
    gl.uniform1f(s.u.uCityI,opt.cityI==null?1.5:opt.cityI);
    gl.uniform1f(s.u.uSpec,opt.spec==null?0.18:opt.spec);
    gl.uniform1f(s.u.uEmit,opt.emit==null?0:opt.emit);
    const hasEnv=!!(texEnvD&&texEnvS);
    gl.uniform1f(s.u.uHasEnv,hasEnv?1:0);
    gl.uniform1f(s.u.uEnvI,opt.envI==null?1.0:opt.envI);
    gl.uniform1f(s.u.uReflI,opt.reflI==null?0.18:opt.reflI);
    if(hasEnv){
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,texEnvD); gl.uniform1i(s.u.uEnvD,1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,texEnvS); gl.uniform1i(s.u.uEnvS,2);
    }
    const hasG=!!(opt.gtex&&texGDry&&texGRock);
    gl.uniform1f(s.u.uHasG,hasG?1:0); gl.uniform1f(s.u.uGScale,1/34);
    if(hasG){
      gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D,texGDry); gl.uniform1i(s.u.uG0,3);
      gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D,texGRock); gl.uniform1i(s.u.uG1,4);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,o.pos);gl.enableVertexAttribArray(s.a.aPos);gl.vertexAttribPointer(s.a.aPos,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,o.nrm);gl.enableVertexAttribArray(s.a.aNrm);gl.vertexAttribPointer(s.a.aNrm,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,o.col);gl.enableVertexAttribArray(s.a.aCol);gl.vertexAttribPointer(s.a.aCol,3,gl.FLOAT,false,0,0);
    if(o.idx){gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,o.idx);gl.drawElements(gl.TRIANGLES,count,gl.UNSIGNED_SHORT,0);}
    else gl.drawArrays(gl.TRIANGLES,0,count);
  }
  function drawCity(o,count,opt,now){
    if(!progB || !o.info) return drawSolid(o,count,opt);
    const s=progB; gl.useProgram(s.p);
    gl.uniformMatrix4fv(s.u.uMVP,false,opt.mvp);
    gl.uniform3fv(s.u.uCam,opt.cam);
    gl.uniform3fv(s.u.uSun,SUN); gl.uniform3fv(s.u.uSunC,SUNC);
    gl.uniform3fv(s.u.uSkyC,SKYC); gl.uniform3fv(s.u.uFog,FOGC);
    gl.uniform3fv(s.u.uCityP,[CITY.x,CITY.y+80,CITY.z]); gl.uniform3fv(s.u.uCityC,CITYC);
    gl.uniform1f(s.u.uNear,opt.near==null?NEAR:opt.near);
    gl.uniform1f(s.u.uFar,opt.far==null?FAR:opt.far);
    gl.uniform1f(s.u.uCityI,opt.cityI==null?1.5:opt.cityI);
    gl.uniform1f(s.u.uTime,now||0);
    const hasEnv=!!(texEnvD&&texEnvS);
    gl.uniform1f(s.u.uHasEnv,hasEnv?1:0);
    gl.uniform1f(s.u.uEnvI,opt.envI==null?1.0:opt.envI);
    gl.uniform1f(s.u.uReflI,opt.reflI==null?0.18:opt.reflI);
    if(hasEnv){
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,texEnvD); gl.uniform1i(s.u.uEnvD,1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,texEnvS); gl.uniform1i(s.u.uEnvS,2);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER,o.pos);gl.enableVertexAttribArray(s.a.aPos);gl.vertexAttribPointer(s.a.aPos,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,o.nrm);gl.enableVertexAttribArray(s.a.aNrm);gl.vertexAttribPointer(s.a.aNrm,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,o.col);gl.enableVertexAttribArray(s.a.aCol);gl.vertexAttribPointer(s.a.aCol,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,o.info);gl.enableVertexAttribArray(s.a.aInfo);gl.vertexAttribPointer(s.a.aInfo,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,o.ctr);gl.enableVertexAttribArray(s.a.aCtr);gl.vertexAttribPointer(s.a.aCtr,2,gl.FLOAT,false,0,0);
    gl.drawArrays(gl.TRIANGLES,0,count);
    gl.disableVertexAttribArray(s.a.aInfo); gl.disableVertexAttribArray(s.a.aCtr);
  }
  function drawQuad(o,opt){
    if(!progT) return;
    const s=progT; gl.useProgram(s.p);
    gl.uniformMatrix4fv(s.u.uMVP,false,opt.mvp);
    gl.uniform3fv(s.u.uCam,opt.cam); gl.uniform3fv(s.u.uFog,FOGC);
    gl.uniform1f(s.u.uAlpha,opt.alpha==null?1:opt.alpha); gl.uniform1f(s.u.uGlow,opt.glow==null?1:opt.glow);
    gl.uniform1f(s.u.uNear,opt.near==null?NEAR:opt.near); gl.uniform1f(s.u.uFar,opt.far==null?FAR:opt.far);
    gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D,o.tex); gl.uniform1i(s.u.uTex,5);
    gl.bindBuffer(gl.ARRAY_BUFFER,o.pos);gl.enableVertexAttribArray(s.a.aPos);gl.vertexAttribPointer(s.a.aPos,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,o.uv);gl.enableVertexAttribArray(s.a.aUV);gl.vertexAttribPointer(s.a.aUV,2,gl.FLOAT,false,0,0);
    gl.disable(gl.CULL_FACE);
    gl.drawArrays(gl.TRIANGLES,0,6);
    gl.enable(gl.CULL_FACE);
    gl.disableVertexAttribArray(s.a.aUV);
  }
  function drawPts(o,count,opt){
    const s=progP; gl.useProgram(s.p);
    gl.uniformMatrix4fv(s.u.uMVP,false,opt.mvp);
    gl.uniform3fv(s.u.uCam,opt.cam); gl.uniform3fv(s.u.uOff,opt.off||[0,0,0]);
    gl.uniform3fv(s.u.uFog,FOGC);
    gl.uniform1f(s.u.uMax,opt.max==null?6:opt.max);
    gl.uniform1f(s.u.uNear,opt.near==null?NEAR:opt.near);
    gl.uniform1f(s.u.uFar,opt.far==null?FAR:opt.far);
    gl.uniform1f(s.u.uBoost,opt.boost==null?1:opt.boost);
    gl.uniform1f(s.u.uAlpha,opt.alpha==null?1:opt.alpha);
    gl.uniform1f(s.u.uSoft,opt.soft==null?1:opt.soft);
    gl.bindBuffer(gl.ARRAY_BUFFER,o.pos);gl.enableVertexAttribArray(s.a.aPos);gl.vertexAttribPointer(s.a.aPos,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,o.col);gl.enableVertexAttribArray(s.a.aCol);gl.vertexAttribPointer(s.a.aCol,3,gl.FLOAT,false,0,0);
    gl.bindBuffer(gl.ARRAY_BUFFER,o.siz);gl.enableVertexAttribArray(s.a.aSize);gl.vertexAttribPointer(s.a.aSize,1,gl.FLOAT,false,0,0);
    gl.drawArrays(gl.POINTS,0,count);
  }
  function drawLn(o,count,opt){
    if(opt.alpha<=0.002) return;
    const s=progL; gl.useProgram(s.p);
    gl.uniformMatrix4fv(s.u.uMVP,false,opt.mvp);
    gl.uniform3fv(s.u.uCam,opt.cam);
    gl.uniform3fv(s.u.uCol,opt.col); gl.uniform3fv(s.u.uFog,FOGC);
    gl.uniform1f(s.u.uNear,opt.near==null?NEAR:opt.near);
    gl.uniform1f(s.u.uFar,opt.far==null?FAR:opt.far);
    gl.uniform1f(s.u.uAlpha,opt.alpha);
    gl.uniform1f(s.u.uNF,opt.nf==null?1:opt.nf);
    gl.bindBuffer(gl.ARRAY_BUFFER,o.pos);gl.enableVertexAttribArray(s.a.aPos);gl.vertexAttribPointer(s.a.aPos,3,gl.FLOAT,false,0,0);
    gl.drawArrays(gl.LINES,0,count);
  }

  /* ---------- the craft: a smooth swept lifting body ----------
     Built on a (u,v) surface grid with analytic normals, so the hull
     reads as one continuous shell instead of a bag of facets.        */
  const FLY_L=8.4, FLY_NOSE=4.70, FLY_TAIL=-3.70;
  function planW(u){ return 2.95*Math.pow(Math.max(0,1-u),0.45)*(0.30+0.70*Math.pow(Math.min(1,u*2.6),0.80)); }
  function thick(u){ return (0.30+0.72*Math.sin(Math.PI*Math.pow(Math.max(0,Math.min(1,u)),0.85)))*(1-0.70*Math.pow(u,4)); }
  function hullPt(u,v,top){
    const x=FLY_TAIL+(FLY_NOSE-FLY_TAIL)*u;
    const w=planW(u), z=v*w;
    const s2=Math.sqrt(Math.max(0,1-v*v));
    const canopy = (u>0.54&&u<0.88&&Math.abs(v)<0.55)
      ? 0.16*Math.sin((u-0.54)/0.34*Math.PI)*Math.cos(v*1.6) : 0;
    const y = top ? (thick(u)*s2+canopy) : (-0.32*thick(u)*s2);
    return [x,y,z];
  }
  function hullNrm(u,v,top){
    const e=0.004;
    const p0=hullPt(u,v,top);
    const pu=hullPt(Math.min(1,u+e),v,top), pv=hullPt(u,Math.min(1,v+e),top);
    const ax=pu[0]-p0[0],ay=pu[1]-p0[1],az=pu[2]-p0[2];
    const bx=pv[0]-p0[0],by=pv[1]-p0[1],bz=pv[2]-p0[2];
    let nx=ay*bz-az*by, ny=az*bx-ax*bz, nz=ax*by-ay*bx;
    const l=Math.hypot(nx,ny,nz)||1; nx/=l;ny/=l;nz/=l;
    if((top&&ny<0)||(!top&&ny>0)){ nx=-nx;ny=-ny;nz=-nz; }
    return [nx,ny,nz];
  }
  function buildFlyer(){
    const P=[],N=[],C=[];
    const HULL=[0.56,0.58,0.63], DARK=[0.20,0.215,0.24], GLASS=[0.16,0.31,0.37];
    const put=(p,n,c)=>{P.push(p[0],p[1],p[2]);N.push(n[0],n[1],n[2]);C.push(c[0],c[1],c[2]);};
    const NU=26, NV=16;
    for(let side=0;side<2;side++){
      const sg=side?1:-1;
      for(let i=0;i<NU;i++){
        const u0=i/NU, u1=(i+1)/NU;
        for(let j=0;j<NV;j++){
          const v0=(j/NV)*sg, v1=((j+1)/NV)*sg;
          [true,false].forEach(top=>{
            const q=[[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(([a2,b2])=>hullPt(a2,b2,top));
            const nn=[[u0,v0],[u1,v0],[u1,v1],[u0,v1]].map(([a2,b2])=>hullNrm(a2,b2,top));
            const mid=(u0+u1)/2, av=Math.abs((v0+v1)/2);
            const col = top ? ((mid>0.54&&mid<0.88&&av<0.55)?GLASS:HULL) : DARK;
            const order = (top===(sg>0)) ? [0,1,2, 0,2,3] : [0,2,1, 0,3,2];
            order.forEach(k=>put(q[k],nn[k],col));
          });
        }
      }
    }
    // twin thruster nacelles at the trailing edge
    [-1.55,1.55].forEach(zz=>{
      for(let k=0;k<12;k++){
        const a1=(k/12)*Math.PI*2,a2=((k+1)/12)*Math.PI*2,R=0.50;
        const y1=0.30+Math.sin(a1)*R,y2=0.30+Math.sin(a2)*R;
        const w1=zz+Math.cos(a1)*R,w2=zz+Math.cos(a2)*R;
        const n1=[0,Math.sin(a1),Math.cos(a1)], n2=[0,Math.sin(a2),Math.cos(a2)];
        put([-2.10,y1,w1],n1,DARK); put([-4.05,y1,w1],n1,DARK); put([-4.05,y2,w2],n2,DARK);
        put([-2.10,y1,w1],n1,DARK); put([-4.05,y2,w2],n2,DARK); put([-2.10,y2,w2],n2,DARK);
      }
    });
    return {P:new Float32Array(P),N:new Float32Array(N),C:new Float32Array(C),n:P.length/3};
  }

  /* ================================================================ */
  function build(){
    const cv=document.getElementById('sv-canvas');
    try{ gl=cv.getContext('webgl',{antialias:true,alpha:false,depth:true}); }catch(e){}
    if(!gl) return false;
    { const hp=gl.getShaderPrecisionFormat(gl.FRAGMENT_SHADER,gl.HIGH_FLOAT);
      PREC=(hp&&hp.precision>0)?'precision highp float;\n':'precision mediump float;\n'; }

    progSky=prog(SKY_V,SKY_F,['aP'],['uF','uR','uU','uTx','uTy','uHor','uMid','uZen','uGround','uGlow','uCityDir','uGlowI','uHasSky','uSky']);
    progS=prog(S_V,S_F,['aPos','aNrm','aCol'],['uMVP','uCam','uSun','uSunC','uSkyC','uFog','uCityP','uCityC','uNear','uFar','uCityI','uSpec','uEmit','uEnvI','uReflI','uHasEnv','uEnvD','uEnvS','uHasG','uGScale','uG0','uG1']);
    progC=prog(C_V,C_F,['aPos','aNrm','aCol','aEmi','aMet','aRough'],['uMVP','uModel','uCam','uBmin','uSpan','uSun','uSunC','uFog','uCityP','uCityC','uNear','uFar','uCityI','uEmitI','uEnvI','uReflI','uEnvD','uEnvS']);
    progP=prog(P_V,P_F,['aPos','aCol','aSize'],['uMVP','uCam','uOff','uMax','uNear','uFar','uBoost','uAlpha','uSoft','uFog']);
    { const hasAA=!!gl.getExtension('OES_standard_derivatives');
      const BU=['uMVP','uCam','uSun','uSunC','uSkyC','uFog','uCityP','uCityC','uNear','uFar','uCityI','uEnvI','uReflI','uHasEnv','uTime','uEnvD','uEnvS'];
      progB=prog(B_V,B_F(hasAA),['aPos','aNrm','aCol','aInfo','aCtr'],BU) || prog(B_V,B_F(false),['aPos','aNrm','aCol','aInfo','aCtr'],BU); }
    progT=prog(T_V,T_F,['aPos','aUV'],['uMVP','uCam','uTex','uAlpha','uNear','uFar','uFog','uGlow']);
    progL=prog(L_V,L_F,['aPos'],['uMVP','uCam','uCol','uFog','uNear','uFar','uAlpha','uNF']);
    if(!progSky||!progS||!progP||!progL) return false;
    skyQuad=buf(new Float32Array([-1,-1,3,-1,-1,3]));

    /* photographic sky + lighting maps, if they arrived */
    const mkTex=(img)=>{
      const tx=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,tx);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGB,gl.RGB,gl.UNSIGNED_BYTE,img);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
      return tx;
    };
    if(ASSET.sky)  texSky =mkTex(ASSET.sky);
    if(ASSET.envD) texEnvD=mkTex(ASSET.envD);
    if(ASSET.envS) texEnvS=mkTex(ASSET.envS);
    /* ground: tiled in both directions, sharpened at grazing angles where the eye sits during the survey */
    extAniso=gl.getExtension('EXT_texture_filter_anisotropic')||gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic');
    const mkTile=(img)=>{
      const tx=mkTex(img);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.REPEAT);
      if(extAniso){ const mx=gl.getParameter(extAniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT)||1; gl.texParameterf(gl.TEXTURE_2D,extAniso.TEXTURE_MAX_ANISOTROPY_EXT,Math.min(8,mx)); }
      return tx;
    };
    if(ASSET.gDry && ASSET.gRock){ texGDry=mkTile(ASSET.gDry); texGRock=mkTile(ASSET.gRock); }

    /* the packed craft */
    if(ASSET.craft && progC){
      try{
        const {hdr,b64}=ASSET.craft;
        const bin=atob(b64), bytes=new Uint8Array(bin.length);
        for(let k=0;k<bin.length;k++) bytes[k]=bin.charCodeAt(k);
        const vb=gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER,vb);
        gl.bufferData(gl.ARRAY_BUFFER,bytes.subarray(0,hdr.vbytes),gl.STATIC_DRAW);
        const ib=gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,ib);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER,bytes.subarray(hdr.vbytes,hdr.vbytes+hdr.ibytes),gl.STATIC_DRAW);
        craftGL={vb,ib,hdr,span:[hdr.bmax[0]-hdr.bmin[0],hdr.bmax[1]-hdr.bmin[1],hdr.bmax[2]-hdr.bmin[2]]};
      }catch(e){ craftGL=null; }
    }

    const small=innerWidth<760;
    let seed=99991; const rnd=()=>(seed=(seed*16807)%2147483647)/2147483647;

    /* the building prototypes, decoded once from the packed file */
    const PROTO={};
    if(ASSET.bldg){
      try{
        ASSET.bldg.protos.forEach(pr=>{
          const {hdr,b64}=pr; const bin=atob(b64), by=new Uint8Array(bin.length);
          for(let k=0;k<bin.length;k++) by[k]=bin.charCodeAt(k);
          const dv=new DataView(by.buffer);
          const nV=hdr.vbytes/20, span=[hdr.bmax[0]-hdr.bmin[0],hdr.bmax[1]-hdr.bmin[1],hdr.bmax[2]-hdr.bmin[2]];
          const pos=new Float32Array(nV*3), nrm=new Float32Array(nV*3), col=new Float32Array(nV*3), emi=new Float32Array(nV*3);
          for(let v=0;v<nV;v++){
            const o=v*20;
            for(let k=0;k<3;k++){
              pos[v*3+k]=(dv.getInt16(o+k*2,true)+32768)/65535*span[k]+hdr.bmin[k];
              nrm[v*3+k]=dv.getInt8(o+8+k)/127;
              col[v*3+k]=Math.pow(by[o+12+k]/255,2.2);
              emi[v*3+k]=Math.pow(by[o+16+k]/255,2.2);
            }
          }
          let nI=0; hdr.chunks.forEach(c=>nI+=c.in);
          const idx=new Uint32Array(nI); let w=0;
          hdr.chunks.forEach(c=>{ for(let k=0;k<c.in;k++) idx[w++]=dv.getUint16(hdr.vbytes+(c.io+k)*2,true)+c.vo; });
          PROTO[hdr.name]={pos,nrm,col,emi,idx,h:hdr.h,w:hdr.w,d:hdr.d,name:hdr.name};
        });
      }catch(e){ for(const k in PROTO) delete PROTO[k]; }
    }
    const protoList=Object.values(PROTO).filter(p=>p.name!=='mega').sort((a,b)=>a.h-b.h);
    const useModels=protoList.length>=8 && PROTO.b24;
    useModelsHero=!!useModels;

    /* ---- ground ---- */
    const A=small?190:300, B=small?62:90, WIDE=760, n=A*B;
    const gp=new Float32Array(n*3),gn=new Float32Array(n*3),gc=new Float32Array(n*3);
    const pc=new Float32Array(n*3),ps=new Float32Array(n);
    let i=0;
    for(let a=0;a<A;a++){
      const bs=basisAt(a/(A-1));
      for(let b=0;b<B;b++){
        const s=(b/(B-1)-0.5)*WIDE;
        const x=bs.c[0]+bs.r[0]*s, z=bs.c[2]+bs.r[1]*s, y=H(x,z);
        gp[i*3]=x;gp[i*3+1]=y;gp[i*3+2]=z;
        const nm=normalAt(x,z); gn[i*3]=nm[0];gn[i*3+1]=nm[1];gn[i*3+2]=nm[2];
        const e=clamp((y+20)/40,0,1);
        const g=0.085+0.105*e, w=0.92+0.16*Math.sin(x*0.13)*Math.cos(z*0.11);
        gc[i*3]=g*1.55*w; gc[i*3+1]=g*1.06*w; gc[i*3+2]=g*0.80*w;
        pc[i*3]=g*3.1; pc[i*3+1]=g*2.0; pc[i*3+2]=g*1.5;
        ps[i]=0.7+e*1.2; i++;
      }
    }
    const idx=new Uint16Array((A-1)*(B-1)*6); let q=0;
    for(let a=0;a<A-1;a++)for(let b=0;b<B-1;b++){
      const v=a*B+b;
      idx[q++]=v;idx[q++]=v+1;idx[q++]=v+B;
      idx[q++]=v+1;idx[q++]=v+B+1;idx[q++]=v+B;
    }
    const gposB=buf(gp);
    ground={pos:gposB,nrm:buf(gn),col:buf(gc),idx:buf(idx,gl.ELEMENT_ARRAY_BUFFER),n:idx.length};
    gpts={pos:gposB,col:buf(pc),siz:buf(ps),n};

    /* ---- stars ---- */
    const SC=1400,sp=new Float32Array(SC*3),sc2=new Float32Array(SC*3),ss=new Float32Array(SC);
    for(let k=0;k<SC;k++){
      const th=Math.random()*Math.PI*2, ph=Math.acos(Math.random()*0.94+0.03), R=2400;
      sp[k*3]=R*Math.sin(ph)*Math.cos(th);
      sp[k*3+1]=Math.abs(R*Math.cos(ph))*0.66+180;
      sp[k*3+2]=R*Math.sin(ph)*Math.sin(th);
      const b=0.34+Math.random()*0.66;
      sc2[k*3]=b;sc2[k*3+1]=b*0.96;sc2[k*3+2]=b*0.90; ss[k]=0.8+Math.random()*2.0;
    }
    stars={pos:buf(sp),col:buf(sc2),siz:buf(ss),n:SC};

    /* ---- pylons ---- */
    const pv=[],cvv=[],PN=26;
    for(let k=0;k<PN;k++){
      const u=0.06+k*0.031, bs=basisAt(Math.min(0.98,u));
      const x=bs.c[0]+bs.r[0]*190, z=bs.c[2]+bs.r[1]*190, y=H(x,z);
      pv.push(x,y,z, x,y+26,z, x-7,y+20,z, x+7,y+20,z, x-5,y+25,z, x+5,y+25,z,
              x-7,y+20,z, x,y+26,z, x+7,y+20,z, x,y+26,z);
      if(k>0){
        const pb=basisAt(Math.min(0.98,u-0.031));
        const px=pb.c[0]+pb.r[0]*190,pz=pb.c[2]+pb.r[1]*190,py=H(px,pz)+25,cy=y+25;
        for(let s=0;s<6;s++){
          const u1=s/6,u2=(s+1)/6,sag=w=>-Math.sin(w*Math.PI)*3.4;
          cvv.push(px+(x-px)*u1,py+(cy-py)*u1+sag(u1),pz+(z-pz)*u1,
                   px+(x-px)*u2,py+(cy-py)*u2+sag(u2),pz+(z-pz)*u2);
        }
      }
    }
    pylons={pos:buf(new Float32Array(pv)),n:pv.length/3};
    cats={pos:buf(new Float32Array(cvv)),n:cvv.length/3};

    /* ---- stations: a concrete pad, two masts, a lit signage board facing the way you come ---- */
    const ts=[0.05,0.14,0.23,0.33];
    const SP=[],SN=[],SCc=[];
    const sface=(a,b,c,d,col)=>{
      const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2], vx=d[0]-a[0],vy=d[1]-a[1],vz=d[2]-a[2];
      let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx; const l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;
      [a,b,c,a,c,d].forEach(v=>{SP.push(v[0],v[1],v[2]);SN.push(nx,ny,nz);SCc.push(col[0],col[1],col[2]);});
    };
    // an axis box rotated about y by ang, centred at (x,z), base y0
    const sbox=(x,y0,z,w,h,d,ang,col)=>{
      const ca=Math.cos(ang),sa=Math.sin(ang);
      const P=(lx,ly,lz)=>[x+lx*ca+lz*sa, y0+ly, z-lx*sa+lz*ca];
      const c=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]];
      for(let e=0;e<4;e++){ const p1=c[e],p2=c[(e+1)%4];
        sface(P(p1[0],0,p1[1]),P(p2[0],0,p2[1]),P(p2[0],h,p2[1]),P(p1[0],h,p1[1]),col); }
      sface(P(c[0][0],h,c[0][1]),P(c[1][0],h,c[1][1]),P(c[2][0],h,c[2][1]),P(c[3][0],h,c[3][1]),[col[0]*0.85,col[1]*0.85,col[2]*0.9]);
    };
    const mkBoard=(p)=>{
      const cv=document.createElement('canvas'); cv.width=1024; cv.height=512; const c=cv.getContext('2d');
      c.fillStyle='rgba(6,8,12,0.88)'; c.fillRect(0,0,1024,512);
      c.strokeStyle='rgba(95,185,168,0.55)'; c.lineWidth=3; c.strokeRect(6,6,1012,500);
      c.fillStyle='#5FB9A8'; c.fillRect(0,0,14,512);
      c.fillStyle='#5FB9A8'; c.font='500 30px "JetBrains Mono", ui-monospace, monospace'; c.fillText(('PROJECT '+p.no).toUpperCase(),60,80);
      c.fillStyle='#E8E3D9'; c.font='700 96px Archivo, "Helvetica Neue", Arial, sans-serif';
      const name=p.name.toUpperCase(); let fs=96; while(c.measureText(name).width>900 && fs>44){ fs-=6; c.font='700 '+fs+'px Archivo, "Helvetica Neue", Arial, sans-serif'; }
      c.fillText(name,56,110+fs);
      c.fillStyle='#8A8177'; c.font='500 30px "JetBrains Mono", ui-monospace, monospace'; c.fillText(p.kind.toUpperCase(),60,150+fs+34);
      c.fillStyle='#5E574F'; c.font='500 24px "JetBrains Mono", ui-monospace, monospace';
      c.fillText(String(p.year)+'  ·  '+String(p.status).toUpperCase(),60,470);
      c.fillStyle='#E07A44'; c.textAlign='right'; c.fillText('CLICK FOR DETAILS  →',960,470); c.textAlign='left';
      const tx=gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D,tx);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,true); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);
      gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,cv);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D);
      return tx;
    };
    PROJECTS.forEach((p,k)=>{
      const tt=ts[k%ts.length], bs=basisAt(tt), off=(k%2?34:-34);
      const gx=bs.c[0]+bs.r[0]*off, gz=bs.c[2]+bs.r[1]*off, gy=H(gx,gz);
      const ang=Math.atan2(bs.f[0],bs.f[1]);              // board faces back down the route
      const fx=-bs.f[0], fz=-bs.f[1];                       // its normal
      const rx=bs.r[0], rz=bs.r[1];
      // pad + plinth + masts + crossbar
      sbox(gx,gy-0.4,gz,22,1.0,16,ang,[0.11,0.105,0.10]);
      sbox(gx,gy+0.6,gz,9,0.9,6,ang,[0.09,0.085,0.08]);
      const BW=16, BH=8, BY=5.2, MH=BY+BH+0.6;
      sbox(gx+rx*(BW/2+0.4),gy+0.6,gz+rz*(BW/2+0.4),0.55,MH,0.55,ang,[0.30,0.31,0.33]);
      sbox(gx-rx*(BW/2+0.4),gy+0.6,gz-rz*(BW/2+0.4),0.55,MH,0.55,ang,[0.30,0.31,0.33]);
      sbox(gx,gy+0.6+MH,gz,BW+1.6,0.45,0.9,ang,[0.30,0.31,0.33]);
      // the board quad, standing just in front of the masts
      const y0=gy+0.6+BY, y1=y0+BH, o2=0.6;
      const c0=[gx-rx*BW/2+fx*o2,y0,gz-rz*BW/2+fz*o2], c1=[gx+rx*BW/2+fx*o2,y0,gz+rz*BW/2+fz*o2];
      const c2=[gx+rx*BW/2+fx*o2,y1,gz+rz*BW/2+fz*o2], c3=[gx-rx*BW/2+fx*o2,y1,gz-rz*BW/2+fz*o2];
      const qp=new Float32Array([...c0,...c1,...c2, ...c0,...c2,...c3]);
      const quv=new Float32Array([0,0, 1,0, 1,1, 0,0, 1,1, 0,1]);
      // landing ring on the ground
      const rv=[],RR=17;
      for(let s2=0;s2<44;s2++){
        const a1=(s2/44)*Math.PI*2,a2=((s2+1)/44)*Math.PI*2;
        const x1=gx+Math.cos(a1)*RR,z1=gz+Math.sin(a1)*RR, x2=gx+Math.cos(a2)*RR,z2=gz+Math.sin(a2)*RR;
        rv.push(x1,H(x1,z1)+0.4,z1,x2,H(x2,z2)+0.4,z2);
      }
      // lamps: two on the crossbar, one pool on the pad
      const lp=new Float32Array([gx+rx*BW*0.45,gy+0.6+MH+0.6,gz+rz*BW*0.45, gx-rx*BW*0.45,gy+0.6+MH+0.6,gz-rz*BW*0.45, gx+fx*4,gy+0.9,gz+fz*4]);
      const lc=new Float32Array([0.55,0.95,0.88, 0.55,0.95,0.88, 1.0,0.72,0.45]);
      const ls=new Float32Array([3.0,3.0,9.0]);
      const el=document.createElement('button');el.className='sv-label stn';el.type='button';
      el.innerHTML=`<span class="n">Project ${esc(p.no)}</span><span class="t">${esc(p.name)}</span><span class="d">Open details →</span>`;
      hudEl.appendChild(el);
      const tick=document.createElement('div');tick.className='sv-stn';tick.style.left=(tt*100)+'%';
      hud.bar.appendChild(tick);
      const st={p,t:tt,world:[gx+fx*o2,y1+3.5,gz+fz*o2],
        board:{pos:buf(qp),uv:buf(quv),tex:mkBoard(p)},
        ring:{pos:buf(new Float32Array(rv)),n:rv.length/3},
        lamps:{pos:buf(lp),col:buf(lc),siz:buf(ls),n:3},el,tick};
      el.addEventListener('click',()=>openPanel({kind:'project',p}));
      stations.push(st);
    });
    stationSolid={pos:buf(new Float32Array(SP)),nrm:buf(new Float32Array(SN)),col:buf(new Float32Array(SCc)),n:SP.length/3};

    /* ---- THE CITY: tiered towers, neon spines, skyways ---- */
    const CP=[],CN=[],CC=[],CI=[],CX=[],WP=[],WC=[],WS=[],NE=[],SK=[],RF=[],RC=[],RS=[],SVv=[];
    let curInfo=[0,0,1], curCtr=[0,0];   // (seed, baseY, topY) and footprint centre for whatever is being pushed
    const face=(a,b,c,d,col)=>{
      const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2];
      const vx=d[0]-a[0],vy=d[1]-a[1],vz=d[2]-a[2];
      let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
      const l=Math.hypot(nx,ny,nz)||1;nx/=l;ny/=l;nz/=l;
      [a,b,c,a,c,d].forEach(v=>{CP.push(v[0],v[1],v[2]);CN.push(nx,ny,nz);CC.push(col[0],col[1],col[2]);CI.push(curInfo[0],curInfo[1],curInfo[2]);CX.push(curCtr[0],curCtr[1]);});
    };
    const boxTier=(x,z,y0,h,w,d,col)=>{
      const c=[[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]];
      for(let e=0;e<4;e++){
        const p1=c[e],p2=c[(e+1)%4];
        face([x+p1[0],y0,z+p1[1]],[x+p2[0],y0,z+p2[1]],[x+p2[0],y0+h,z+p2[1]],[x+p1[0],y0+h,z+p1[1]],col);
      }
      face([x+c[0][0],y0+h,z+c[0][1]],[x+c[1][0],y0+h,z+c[1][1]],
           [x+c[2][0],y0+h,z+c[2][1]],[x+c[3][0],y0+h,z+c[3][1]],[col[0]*0.8,col[1]*0.8,col[2]*0.9]);
    };
    const NEONS=[[0.45,0.90,0.86],[0.72,0.34,0.92],[0.95,0.34,0.62],[0.36,0.66,0.98]];
    const plots=[];
    /* the megablock sits beside the route where the craft enters the city */
    let MEGA=null;
    if(useModels && PROTO.mega){
      const bs=basisAt(0.795), off=-(PROTO.mega.w/2+62);
      MEGA={x:bs.c[0]+bs.r[0]*off, z:bs.c[2]+bs.r[1]*off, rot:Math.atan2(bs.f[0],bs.f[1])+Math.PI, r:PROTO.mega.w*0.52};
    }
    const placed=[]; // footprints, so buildings never stand inside one another
    const corridor=[]; for(let u=0.70;u<=0.905;u+=0.004){ const c=curveAt(u); corridor.push([c[0],c[2]]); }
    const onRoute=(x,z,r)=>corridor.some(c=>Math.hypot(c[0]-x,c[1]-z)<r+34);
    const heroR=useModels?PROTO.b24.w*HERO.h/PROTO.b24.h*0.5+8:22;
    placed.push({x:HERO.x,z:HERO.z,r:heroR});
    if(MEGA) placed.push({x:MEGA.x,z:MEGA.z,r:MEGA.r});
    const WANT=small?100:150;
    for(let k=0;k<WANT*3 && plots.length<WANT;k++){
      const ang=rnd()*Math.PI*2, rad=Math.pow(rnd(),0.55)*CITY.r;
      const x=CITY.x+Math.cos(ang)*rad, z=CITY.z+Math.sin(ang)*rad;
      const near=1-rad/CITY.r;
      let pl;
      if(useModels){
        // taller prototypes towards the centre; quarter-turn rotations keep the grid feel
        const pick=Math.min(protoList.length-1,Math.floor(clamp(Math.pow(rnd(),1.25)*0.75+near*0.55,0,0.999)*protoList.length));
        const proto=protoList[pick], sc=0.82+rnd()*0.42;
        const rot=Math.floor(rnd()*4)*Math.PI/2;
        const w=(rot%Math.PI<0.1?proto.w:proto.d)*sc, d=(rot%Math.PI<0.1?proto.d:proto.w)*sc;
        pl={x,z,h:proto.h*sc,w,d,proto,sc,rot,spire:false,neon:rnd()>0.55?NEONS[Math.floor(rnd()*4)]:null};
      } else {
        pl={x,z,h:18+Math.pow(rnd(),1.7)*120+near*95,w:8+rnd()*15,d:8+rnd()*15,
            spire:rnd()>0.72, neon:rnd()>0.55?NEONS[Math.floor(rnd()*4)]:null};
      }
      const r=Math.max(pl.w,pl.d)*0.5+3;
      if(placed.some(q=>Math.hypot(q.x-x,q.z-z)<q.r+r)) continue;
      if(onRoute(x,z,r)) continue;
      placed.push({x,z,r}); plots.push(pl);
    }
    if(useModels) plots.push({x:HERO.x,z:HERO.z,h:HERO.h,w:PROTO.b24.w*HERO.h/PROTO.b24.h,d:PROTO.b24.d*HERO.h/PROTO.b24.h,
      proto:PROTO.b24,sc:HERO.h/PROTO.b24.h,rot:0,hero:true,spire:false,neon:[0.42,0.88,0.80]});
    else plots.push({x:HERO.x,z:HERO.z,h:HERO.h,w:21,d:21,hero:true,spire:true,neon:[0.42,0.88,0.80]});
    if(MEGA) plots.push({x:MEGA.x,z:MEGA.z,h:PROTO.mega.h,w:PROTO.mega.w,d:PROTO.mega.d,proto:PROTO.mega,sc:1,rot:MEGA.rot,mega:true,spire:false,neon:null});

    /* a prototype stamped into the merged city buffer, with windows sampled off its real facades */
    const ALB=0.26;
    const stamp=(pl)=>{
      const pr=pl.proto, {x,z,sc,rot}=pl, y=H(x,z)-0.6;
      const cr=Math.cos(rot), sr=Math.sin(rot);
      const idx=pr.idx, P=pr.pos, Nn=pr.nrm, C=pr.col, E=pr.emi;
      const tint=pl.hero?[1.0,1.02,1.0]:pl.mega?[1.0,1.0,1.0]:[0.96+rnd()*0.08,0.96+rnd()*0.06,0.96+rnd()*0.08];
      const alb=pl.mega?ALB*1.35:ALB;
      const tx=(v,o)=>{ const px=P[v*3]*sc, py=P[v*3+1]*sc, pz=P[v*3+2]*sc; o[0]=x+px*cr+pz*sr; o[1]=y+py; o[2]=z-px*sr+pz*cr; };
      const tn=(v,o)=>{ const nx=Nn[v*3], nz=Nn[v*3+2]; o[0]=nx*cr+nz*sr; o[1]=Nn[v*3+1]; o[2]=-nx*sr+nz*cr; };
      const a=[0,0,0], nn=[0,0,0];
      const info=[pl.mega?-1:(pl.hero?2.0+rnd():rnd()), y, y+pr.h*sc];
      for(let k=0;k<idx.length;k++){
        const v=idx[k]; tx(v,a); tn(v,nn);
        CP.push(a[0],a[1],a[2]); CN.push(nn[0],nn[1],nn[2]);
        CC.push(C[v*3]*alb*tint[0], C[v*3+1]*alb*tint[1], C[v*3+2]*alb*tint[2]);
        CI.push(info[0],info[1],info[2]); CX.push(x,z);
      }
      // a few sprites remain for the megablock (its facade is a scan, not a grid)
      const b=[0,0,0], c=[0,0,0];
      const per=pl.mega?0.0016:0.0;
      for(let k=0;k<idx.length && per>0;k+=3){
        tx(idx[k],a); tx(idx[k+1],b); tx(idx[k+2],c);
        const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2], vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
        let nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx; const l=Math.hypot(nx,ny,nz); if(l<1e-6) continue;
        nx/=l;ny/=l;nz/=l; if(Math.abs(ny)>0.35) continue;
        const area=l*0.5; let want=area*per; if(a[1]-y<6) want*=0.3;
        while(want>0){
          if(rnd()>want) break; want-=1;
          let r1=rnd(), r2=rnd(); if(r1+r2>1){r1=1-r1;r2=1-r2;}
          WP.push(a[0]+ux*r1+vx*r2+nx*0.35, a[1]+uy*r1+vy*r2+ny*0.35, a[2]+uz*r1+vz*r2+nz*0.35);
          if(pl.hero) WC.push(0.42,0.82,0.75);
          else{ const rr=rnd(); if(rr>0.90) WC.push(0.72,0.80,0.95); else if(rr>0.84) WC.push(0.62,0.40,0.92); else WC.push(1.00,0.60,0.28); }
          WS.push(1.4+rnd()*1.9);
        }
      }
      // the megablock's lit panels
      if(pl.mega){
        for(let v=0;v<P.length/3;v+=3){
          if(E[v*3]+E[v*3+1]+E[v*3+2]<0.25) continue;
          tx(v,a); tn(v,nn);
          WP.push(a[0]+nn[0]*0.6,a[1]+nn[1]*0.6,a[2]+nn[2]*0.6);
          WC.push(Math.min(1,E[v*3]*1.6+0.2),Math.min(1,E[v*3+1]*1.4+0.1),Math.min(1,E[v*3+2]*1.6+0.2)); WS.push(2.2);
        }
      }
    };

    plots.forEach(pl=>{
      const {x,z,h,w,d}=pl, y=H(x,z);
      curInfo=[pl.hero?2.5:rnd(), y, y+h]; curCtr=[x,z];
      if(pl.proto){
        stamp(pl);
        if(!pl.mega){ RF.push(x,y+h+1.4,z); RC.push(1.0,0.32,0.26); RS.push(pl.hero?2.8:2.0); }
        if(pl.neon){
          const c=pl.neon, hgt=h*(0.50+rnd()*0.35), y1=y+h*0.08;
          [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].forEach(([ox,oz],ci)=>{
            if(ci%2 && !pl.hero) return;
            NE.push(x+ox,y1,z+oz, x+ox,y1+hgt,z+oz, c[0],c[1],c[2]);
          });
        }
        return;
      }
      const tone=0.019+rnd()*0.017;
      const col=[tone*1.25,tone*1.08,tone];
      // two or three setback tiers, the way the reference towers step in
      const tiers=pl.hero?3:(rnd()>0.5?2:1);
      let y0=y, hh=h, ww=w, dd=d;
      for(let ti=0;ti<tiers;ti++){
        const seg=hh*(ti===tiers-1?1:0.55);
        boxTier(x,z,y0,seg,ww,dd,col);
        y0+=seg; hh-=seg; ww*=0.74; dd*=0.74;
        if(hh<=1) break;
      }
      const topY2=y+h;
      if(pl.spire){
        const sh=pl.hero?46:14+rnd()*26, sw=ww*0.22;
        boxTier(x,z,topY2,sh,sw,sw,[tone*0.9,tone*0.85,tone*0.95]);
        RF.push(x,topY2+sh+1.6,z); RC.push(1.0,0.32,0.26); RS.push(2.6);
      } else { RF.push(x,topY2+1.2,z); RC.push(1.0,0.34,0.28); RS.push(2.0); }

      // neon spines up the corners
      if(pl.neon){
        const c=pl.neon, hgt=h*(0.55+rnd()*0.4), y1=y+h*0.06;
        [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]].forEach(([ox,oz],ci)=>{
          if(ci%2 && !pl.hero) return;
          NE.push(x+ox,y1,z+oz, x+ox,y1+hgt,z+oz, c[0],c[1],c[2]);
        });
      }
      // windows
      const rows=Math.max(5,Math.floor(h/4.6)), per=pl.hero?16:11;
      for(let r=1;r<rows;r++) for(let q2=0;q2<per;q2++){
        if(rnd()>(pl.hero?0.80:0.56)) continue;
        const side=Math.floor(rnd()*4), u=0.14+rnd()*0.72;
        let px,pz;
        if(side===0){px=x-w/2+w*u;pz=z-d/2-0.15;}
        else if(side===1){px=x+w/2+0.15;pz=z-d/2+d*u;}
        else if(side===2){px=x-w/2+w*u;pz=z+d/2+0.15;}
        else {px=x-w/2-0.15;pz=z-d/2+d*u;}
        WP.push(px,y+r*(h/rows),pz);
        if(pl.hero) WC.push(0.42,0.82,0.75);
        else{
          const rr=rnd();
          if(rr>0.90) WC.push(0.72,0.80,0.95);
          else if(rr>0.84) WC.push(0.62,0.40,0.92);
          else WC.push(1.00,0.60,0.28);
        }
        WS.push(1.5+rnd()*2.0);
      }
    });

    // neon spines as their own line buffer, coloured per segment
    const nePos=[], neCol=[];
    for(let k=0;k<NE.length;k+=9){
      nePos.push(NE[k],NE[k+1],NE[k+2],NE[k+3],NE[k+4],NE[k+5]);
      neCol.push(NE[k+6],NE[k+7],NE[k+8]);
    }
    neon={pos:buf(new Float32Array(nePos)),n:nePos.length/3,cols:neCol};
    { // glow sampled along each spine, so the neon blooms
      const NP=[],NC=[],NS=[];
      for(let k=0;k<nePos.length;k+=6){
        const c=neCol.slice((k/6)*3,(k/6)*3+3);
        for(let s2=0;s2<=9;s2++){
          const u=s2/9;
          NP.push(lerp(nePos[k],nePos[k+3],u),lerp(nePos[k+1],nePos[k+4],u),lerp(nePos[k+2],nePos[k+5],u));
          NC.push(c[0],c[1],c[2]); NS.push(2.4);
        }
      }
      neonGlow={pos:buf(new Float32Array(NP)),col:buf(new Float32Array(NC)),siz:buf(new Float32Array(NS)),n:NP.length/3};
    }

    // elevated skyways arcing between towers, with light running along them
    const tall=plots.filter(p=>p.h>110);
    for(let k=0;k+1<tall.length && k<22;k+=2){
      const a=tall[k],b=tall[k+1];
      if(Math.hypot(a.x-b.x,a.z-b.z)>260) continue;
      const ay=H(a.x,a.z)+a.h*0.62, by=H(b.x,b.z)+b.h*0.62;
      let prev=null;
      for(let s=0;s<=14;s++){
        const u=s/14;
        const px=lerp(a.x,b.x,u), pz=lerp(a.z,b.z,u);
        const py=lerp(ay,by,u)+Math.sin(u*Math.PI)*18;
        if(prev) SK.push(prev[0],prev[1],prev[2],px,py,pz);
        prev=[px,py,pz];
      }
    }
    skyways={pos:buf(new Float32Array(SK)),n:SK.length/3};

    city={pos:buf(new Float32Array(CP)),nrm:buf(new Float32Array(CN)),col:buf(new Float32Array(CC)),info:buf(new Float32Array(CI)),ctr:buf(new Float32Array(CX)),n:CP.length/3};
    cityWin={pos:buf(new Float32Array(WP)),col:buf(new Float32Array(WC)),siz:buf(new Float32Array(WS)),n:WP.length/3};
    roof={pos:buf(new Float32Array(RF)),col:buf(new Float32Array(RC)),siz:buf(new Float32Array(RS)),n:RF.length/3};

    for(let k=-5;k<=5;k++){
      const s=k*52;
      SVv.push(CITY.x+s,CITY.y+0.35,CITY.z-230, CITY.x+s,CITY.y+0.35,CITY.z+230);
      SVv.push(CITY.x-230,CITY.y+0.35,CITY.z+s, CITY.x+230,CITY.y+0.35,CITY.z+s);
    }
    streets={pos:buf(new Float32Array(SVv)),n:SVv.length/3};

    /* ---- air traffic ---- */
    const TN=70;
    const tl=[];
    for(let k=0;k<TN;k++){
      const ang=rnd()*Math.PI*2;
      tl.push({a:ang, r:70+rnd()*CITY.r, y:CITY.y+40+rnd()*150, sp:(0.10+rnd()*0.22)*(rnd()>0.5?1:-1), ph:rnd()*100});
    }
    const tc=new Float32Array(TN*3), tsz=new Float32Array(TN);
    for(let k=0;k<TN;k++){
      const warm=rnd()>0.45;
      tc[k*3]=warm?1.0:0.55; tc[k*3+1]=warm?0.72:0.86; tc[k*3+2]=warm?0.42:1.0;
      tsz[k]=1.6+rnd()*1.6;
    }
    traffic={pos:dynb(TN*3),col:buf(tc),siz:buf(tsz),n:TN,arr:new Float32Array(TN*3),lanes:tl};

    /* ---- floors ---- */
    const FL=[['01','About'],['02','Projects'],['03','Experience'],['04','Skills'],['05','Contact']];
    const bv=[];
    FL.forEach((f,k)=>{
      const gy0=H(HERO.x,HERO.z), rel=62+k*43, fy=gy0+rel;
      // where the climb's camera is level with this floor (see cameraAt's ascent)
      const stopU=clamp((rel+6-58)/(HERO.h+42-58),0.02,0.98), stop=0.88+0.12*stopU;
      let w=23;
      if(useModels){ // ring width from the tower's own footprint at this height
        const pr=PROTO.b24, sc=HERO.h/pr.h, rel=(fy-H(HERO.x,HERO.z))/sc; let ext=0;
        for(let v=0;v<pr.pos.length/3;v++){ if(Math.abs(pr.pos[v*3+1]-rel)<5) ext=Math.max(ext,Math.abs(pr.pos[v*3]),Math.abs(pr.pos[v*3+2])); }
        w=ext>0?ext*2*sc+5:23;
      }
      const c=[[-w/2,-w/2],[w/2,-w/2],[w/2,w/2],[-w/2,w/2]];
      for(let e=0;e<4;e++){const p1=c[e],p2=c[(e+1)%4];
        bv.push(HERO.x+p1[0],fy,HERO.z+p1[1],HERO.x+p2[0],fy,HERO.z+p2[1]);}
      const el=document.createElement('button');el.className='sv-label flr';el.type='button';
      el.innerHTML=`<span class="n">Floor ${f[0]}</span><span class="t">${esc(f[1])}</span><span class="d">Open →</span>`;
      hudEl.appendChild(el);
      el.addEventListener('click',()=>openPanel({kind:'floor',k}));
      floors.push({y:fy,el,name:f[1],k,stop,visited:false});
    });
    heroBands={pos:buf(new Float32Array(bv)),n:bv.length/3};

    /* ---- rover ---- */
    const rn=90,rp=new Float32Array(rn*3),rc=new Float32Array(rn*3),rs=new Float32Array(rn);
    for(let k=0;k<rn;k++){
      rp[k*3]=(Math.random()-0.5)*7;rp[k*3+1]=Math.random()*2.4+1.0;rp[k*3+2]=(Math.random()-0.5)*3.6;
      rc[k*3]=0.96;rc[k*3+1]=0.52;rc[k*3+2]=0.28;rs[k]=1.5+Math.random()*1.8;
    }
    rover={pos:buf(rp),col:buf(rc),siz:buf(rs),n:rn};

    /* ---- the craft ---- */
    flyLoc=buildFlyer();
    flyer={pos:dynb(flyLoc.n*3),nrm:dynb(flyLoc.n*3),col:buf(flyLoc.C),n:flyLoc.n,
           ap:new Float32Array(flyLoc.n*3),an:new Float32Array(flyLoc.n*3)};
    { const c=new Float32Array([0.70,0.88,1.0, 0.70,0.88,1.0, 0.70,0.88,1.0, 0.70,0.88,1.0, 1.0,0.80,0.55, 1.0,0.80,0.55]);
      const s=new Float32Array([2.6,2.6,2.6,2.6,1.1,1.1]);
      thrust={pos:dynb(18),col:buf(c),siz:buf(s),n:6,arr:new Float32Array(18)};
    }

    gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND);
    gl.enable(gl.CULL_FACE); gl.cullFace(gl.BACK);
    resize();
    return true;
  }

  function resize(){
    if(!gl) return;
    const cv=gl.canvas, dpr=Math.min(devicePixelRatio||1,1.75);
    cv.width=Math.floor(innerWidth*dpr); cv.height=Math.floor(innerHeight*dpr);
    gl.viewport(0,0,cv.width,cv.height);
  }
  addEventListener('resize',()=>{ if(running) resize(); },{passive:true});

  /* ---------- where the craft is, and where the eye is ---------- */
  function craftAt(v,now){
    const bs=basisAt(Math.min(1,v+0.010));
    let y;
    if(v<0.50){
      // it drops out of the sky and settles into a hover
      const u=sm(0.40,0.50,v);
      y=H(bs.c[0],bs.c[2])+lerp(190,26,u*u);
    } else y=H(bs.c[0],bs.c[2])+altAt(v)-6;
    return {p:[bs.c[0], y+Math.sin(now*0.0013)*0.5, bs.c[2]], f:bs.f};
  }
  function bankAt(v){
    const h1=basisAt(clamp(v-0.006,0,1)).f, h2=basisAt(clamp(v+0.006,0,1)).f;
    const cr=h1[0]*h2[1]-h1[1]*h2[0];
    return clamp(cr*9.0,-0.42,0.42);
  }
  function cameraAt(v,now){
    const act=actAt(v);
    if(act.k==='ascent'){
      const u=sm(0,1,(v-0.88)/0.12), gy=H(HERO.x,HERO.z);
      const hw=useModelsHero?27:10.5;
      const ang=-2.35+u*1.25, rad=lerp(hw+48,hw+27,u);
      const pos=[HERO.x+Math.cos(ang)*rad, lerp(gy+58,gy+HERO.h+42,u), HERO.z+Math.sin(ang)*rad];
      const out=sm(0.74,1.0,u);
      return {pos, look:[lerp(HERO.x,HERO.x-520,out),
        lerp(gy+70+u*HERO.h*0.82, gy+HERO.h+8, out*0.6),
        lerp(HERO.z,HERO.z+300,out)], up:[0,1,0], act};
    }
    const cr=craftAt(v,now), roll=bankAt(v);
    const fwd=[cr.f[0],0,cr.f[1]];
    const rgt=[-fwd[2],0,fwd[0]];

    // ground eye during the survey, chase position once airborne
    const gc0=curveAt(v);
    const gpos=[gc0[0],H(gc0[0],gc0[2])+17,gc0[2]];
    const gl2=curveAt(Math.min(1,v+0.035));
    const glook=[gl2[0],H(gl2[0],gl2[2])+14,gl2[2]];
    if(v<0.42){ // on the ground the eye turns towards each board as it comes up, and holds on it while parked
      let best=null,bw=0;
      stations.forEach(st=>{ const dd=v-(st.t-STATION_LEAD); const w=dd<0?sm(-0.05,0,dd):1-sm(0,0.03,dd); if(w>bw){bw=w;best=st;} });
      if(best&&bw>0){ const k=bw*0.7; glook[0]=lerp(glook[0],best.world[0],k); glook[1]=lerp(glook[1],best.world[1]-4,k); glook[2]=lerp(glook[2],best.world[2],k); }
    }

    const chase=[cr.p[0]-fwd[0]*20+rgt[0]*(5.5-roll*8), cr.p[1]+8.4, cr.p[2]-fwd[2]*20+rgt[2]*(5.5-roll*8)];
    const clook=[cr.p[0]+fwd[0]*12, cr.p[1]+0.6, cr.p[2]+fwd[2]*12];

    const board=sm(0.50,0.60,v);
    const pos=[lerp(gpos[0],chase[0],board),lerp(gpos[1],chase[1],board),lerp(gpos[2],chase[2],board)];
    const lk =[lerp(glook[0],clook[0],board),lerp(glook[1],clook[1],board),lerp(glook[2],clook[2],board)];
    // during the pickup the eye tracks the descending craft
    if(v>0.40&&v<0.52){
      const w=sm(0.40,0.49,v)*(1-sm(0.49,0.56,v));
      lk[0]=lerp(lk[0],cr.p[0],w); lk[1]=lerp(lk[1],cr.p[1],w); lk[2]=lerp(lk[2],cr.p[2],w);
    }
    const c2=Math.cos(roll*board), s2=Math.sin(roll*board);
    return {pos,look:lk,up:[-rgt[0]*s2, c2, -rgt[2]*s2],act,craft:cr,roll};
  }

  function place(el,w,mvp,vis){
    if(vis<=0.01){el.style.opacity=0;return;}
    const cx=mvp[0]*w[0]+mvp[4]*w[1]+mvp[8]*w[2]+mvp[12];
    const cy=mvp[1]*w[0]+mvp[5]*w[1]+mvp[9]*w[2]+mvp[13];
    const cw=mvp[3]*w[0]+mvp[7]*w[1]+mvp[11]*w[2]+mvp[15];
    if(cw<=0.01){el.style.opacity=0;return;}
    el.style.left=Math.min(innerWidth-110,Math.max(110,(cx/cw*0.5+0.5)*innerWidth))+'px';
    el.style.top =Math.min(innerHeight-170,Math.max(172,(-cy/cw*0.5+0.5)*innerHeight))+'px';
    el.style.opacity=vis;
  }

  /* ---------- frame ---------- */
  function frame(now){
    if(!running) return;
    const dt=Math.min(0.05,(now-lastT)/1000); lastT=now;
    if(playing){
      const a=actAt(tTarget).k;
      let rate=a==='transect'?0.030:a==='pickup'?0.016:a==='flight'?0.046:a==='city'?0.026:0.021;
      if(a==='transect'){
        const nx=stations.find(st=>!st.visited && tTarget<st.t-STATION_LEAD && st.t-STATION_LEAD-tTarget<0.028);
        if(nx) rate*=0.42;                              // ease off the throttle coming up to a station
      }
      if(holdUntil>now) rate=0;                         // parked at a station
      tTarget=Math.min(1,tTarget+dt*rate);
      if(a==='transect') stations.forEach(st=>{
        if(st.visited || tTarget<st.t-STATION_LEAD-0.0012) return;
        st.visited=true; tTarget=st.t-STATION_LEAD; holdUntil=now+STATION_HOLD;
      });
    }
    stations.forEach(st=>{ if(tTarget<st.t-STATION_LEAD-0.03) st.visited=false; });
    floors.forEach(f=>{ if(tTarget<f.stop-0.01) f.visited=false; });
    /* an automatic floor stop leaves by itself unless the visitor starts reading */
    if(panelOpen && autoLeaveAt){
      const left=autoLeaveAt-now;
      if(panel.timer) panel.timer.style.width=Math.max(0,Math.min(100,100*(1-left/AUTO_LEAVE)))+'%';
      if(panel.cont) panel.cont.textContent='Continuing in '+Math.max(0,Math.ceil(left/1000))+' s →';
      if(left<=0){ autoLeaveAt=0; closePanel(true); }
    }
    t+=(tTarget-t)*0.075;

    const cam=cameraAt(t,now), act=cam.act;
    const asp=innerWidth/innerHeight, fov=62*Math.PI/180;
    const P=persp(fov,asp,0.35,4200);
    const Vv=look(cam.pos,cam.look,cam.up);
    const mvp=mul(P,Vv.m);
    const o={mvp,cam:cam.pos};

    gl.clear(gl.DEPTH_BUFFER_BIT);

    /* sky */
    gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND);
    { const s=progSky; gl.useProgram(s.p);
      const ty=Math.tan(fov/2);
      gl.uniform3fv(s.u.uF,Vv.f);gl.uniform3fv(s.u.uR,Vv.r);gl.uniform3fv(s.u.uU,Vv.u);
      gl.uniform1f(s.u.uTx,ty*asp);gl.uniform1f(s.u.uTy,ty);
      gl.uniform3fv(s.u.uHor,[0.115,0.076,0.070]);
      gl.uniform3fv(s.u.uMid,[0.060,0.040,0.078]);
      gl.uniform3fv(s.u.uZen,[0.016,0.016,0.040]);
      gl.uniform3fv(s.u.uGround,texSky?FOGC:[0.055,0.040,0.038]);
      gl.uniform3fv(s.u.uGlow,[0.95,0.46,0.22]);
      let dx=CITY.x-cam.pos[0],dz=CITY.z-cam.pos[2];
      const dl=Math.hypot(dx,dz)||1;
      gl.uniform3fv(s.u.uCityDir,[dx/dl,0,dz/dl]);
      gl.uniform1f(s.u.uGlowI,(texSky?0.05:0.06)+0.30*Math.max(0,1-dl/1700));
      gl.uniform1f(s.u.uHasSky,texSky?1:0);
      if(texSky){ gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D,texSky); gl.uniform1i(s.u.uSky,0); }
      gl.bindBuffer(gl.ARRAY_BUFFER,skyQuad);
      gl.enableVertexAttribArray(s.a.aP);gl.vertexAttribPointer(s.a.aP,2,gl.FLOAT,false,0,0);
      gl.drawArrays(gl.TRIANGLES,0,3);
    }
    gl.enable(gl.DEPTH_TEST); gl.enable(gl.BLEND);

    gl.depthMask(false); gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
    drawPts(stars,stars.n,{...o,near:2200,far:7000,max:2.4,soft:1.6});

    /* solids */
    gl.depthMask(true); gl.disable(gl.BLEND);
    drawSolid(ground,ground.n,{...o,spec:0.16,cityI:1.5,envI:1.7,reflI:0.05,gtex:true});
    drawCity(city,city.n,{...o,spec:0.06,cityI:1.6,far:2400,near:60,envI:0.55,reflI:0.10},now);
    if(stationSolid) drawSolid(stationSolid,stationSolid.n,{...o,spec:0.25,cityI:0.6,envI:1.4,reflI:0.12,emit:0.06});
    gl.enable(gl.BLEND);

    /* lights and detail */
    gl.depthMask(false);
    gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
    drawPts(gpts,gpts.n,{...o,max:2.6,alpha:0.45,soft:1.4,far:420});
    drawPts(cityWin,cityWin.n,{...o,far:2600,max:3.8,boost:1.85,soft:1.45});
    drawPts(roof,roof.n,{...o,far:2600,max:4.4,boost:1.6,soft:2.0,
      alpha:0.55+0.45*Math.sin(now*0.004)});
    // neon spines, one draw per colour
    for(let k=0;k<neon.n/2;k++){
      const c=neon.cols.slice(k*3,k*3+3);
      gl.useProgram(progL.p);
      drawLnRange(neon,k*2,2,{...o,col:c,alpha:0.95,nf:6,far:2400});
    }
    drawPts(neonGlow,neonGlow.n,{...o,far:2400,max:7,boost:1.5,soft:2.6,alpha:0.55});
    drawLn(skyways,skyways.n,{...o,col:[0.40,0.72,0.86],alpha:0.42,nf:14,far:2000});
    gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    drawLn(streets,streets.n,{...o,col:[0.32,0.24,0.20],alpha:0.30,nf:26,far:700});
    drawLn(pylons,pylons.n,{...o,col:[0.30,0.52,0.50],alpha:0.62,nf:14});
    drawLn(cats,cats.n,{...o,col:[0.30,0.52,0.50],alpha:0.28,nf:14});
    drawLn(heroBands,heroBands.n,{...o,col:[0.373,0.725,0.659],
      alpha:0.16+(act.k==='ascent'?0.62:0),nf:10,far:1600});

    /* air traffic */
    { const T=traffic, s=now*0.001;
      for(let k=0;k<T.n;k++){
        const L=T.lanes[k], a=L.a+s*L.sp*0.35+L.ph;
        T.arr[k*3]=CITY.x+Math.cos(a)*L.r;
        T.arr[k*3+1]=L.y+Math.sin(s*0.5+L.ph)*4;
        T.arr[k*3+2]=CITY.z+Math.sin(a)*L.r;
      }
      up(T.pos,T.arr);
      gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
      drawPts(T,T.n,{...o,far:2400,max:4.0,boost:1.5,soft:1.6});
      gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    }

    /* stations */
    let nearest=null,nd=1e9;
    stations.forEach(st=>{
      const d=Math.abs(st.t-t); if(d<nd){nd=d;nearest=st;}
      const near=Math.max(0,1-d/0.085);
      drawLn(st.ring,st.ring.n,{...o,col:[0.373,0.725,0.659],alpha:0.10+near*0.52,nf:10});
      drawQuad(st.board,{...o,alpha:0.96,glow:1.35+near*0.5,far:1200});
      gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
      drawPts(st.lamps,st.lamps.n,{...o,boost:1.2+near*0.8,max:26,soft:2.2,alpha:0.7});
      gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
      st.tick.classList.toggle('near',near>0.35);
      const vis=near>0.10?Math.min(1,near*1.8):0;
      place(st.el,st.world,mvp,vis); st.el.style.pointerEvents=vis>0.3?'auto':'none';
    });
    floors.forEach(f=>{
      const d=Math.abs(cam.pos[1]-f.y);
      const vis=act.k==='ascent'&&d<48?Math.min(1,1.25*(1-d/48)):0;
      place(f.el,[HERO.x,f.y,HERO.z],mvp,vis); f.el.style.pointerEvents=vis>0.3?'auto':'none';
    });
    /* the nearest thing worth opening gets a standing cue, playing or not */
    {
      let cue=null;
      if(act.k==='ascent'){
        let bd=1e9; floors.forEach(f=>{ const d=Math.abs(cam.pos[1]-f.y); if(d<26&&d<bd){bd=d;cue={k:'Floor 0'+(f.k+1)+' · '+FLOOR_SUB[f.k],t:f.name,target:{kind:'floor',k:f.k},el:f.el};} });
      } else if(act.k==='transect' && nearest && nd<0.05){
        cue={k:'Station '+nearest.p.no+' · '+nearest.p.kind,t:nearest.p.name,target:{kind:'project',p:nearest.p},el:nearest.el};
      }
      setCue(cue);
    }
    /* floor stops: while playing, the climb pauses at each floor and opens it */
    if(playing && act.k==='ascent'){
      floors.forEach((f,k)=>{
        if(f.visited || tTarget<f.stop-0.0015) return;
        f.visited=true; tTarget=f.stop; openPanel({kind:'floor',k},true);
      });
    }


    const rt=now*0.00012, rx=-120+Math.cos(rt)*70, rz=120+Math.sin(rt*1.3)*50;
    gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
    drawPts(rover,rover.n,{...o,off:[rx,H(rx,rz)+0.6,rz],max:3.8,soft:1.3});
    gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);

    /* ---- the craft ---- */
    if(t>0.395 && t<0.905 && cam.craft && craftGL){
      const cr=cam.craft, roll=cam.roll||0;
      const fx=cr.f[0],fz=cr.f[1];
      const cth=fx, sth=-fz, crl=Math.cos(-roll), srl=Math.sin(-roll);
      // column-major  T · Ry(heading) · Rx(roll)
      const M=new Float32Array([
        cth,0,-sth,0,
        sth*srl,crl,cth*srl,0,
        sth*crl,-srl,cth*crl,0,
        cr.p[0],cr.p[1],cr.p[2],1
      ]);
      const s=progC; gl.useProgram(s.p);
      gl.disable(gl.BLEND); gl.depthMask(true);
      gl.uniformMatrix4fv(s.u.uMVP,false,mvp); gl.uniformMatrix4fv(s.u.uModel,false,M);
      gl.uniform3fv(s.u.uCam,cam.pos);
      gl.uniform3fv(s.u.uBmin,craftGL.hdr.bmin); gl.uniform3fv(s.u.uSpan,craftGL.span);
      gl.uniform3fv(s.u.uSun,SUN); gl.uniform3fv(s.u.uSunC,[SUNC[0]*1.6,SUNC[1]*1.6,SUNC[2]*1.6]);
      gl.uniform3fv(s.u.uFog,FOGC);
      gl.uniform3fv(s.u.uCityP,[CITY.x,CITY.y+80,CITY.z]); gl.uniform3fv(s.u.uCityC,CITYC);
      gl.uniform1f(s.u.uNear,2); gl.uniform1f(s.u.uFar,900);
      gl.uniform1f(s.u.uCityI,3.0); gl.uniform1f(s.u.uEmitI,2.2);
      gl.uniform1f(s.u.uEnvI,1.05); gl.uniform1f(s.u.uReflI,0.95);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D,texEnvD); gl.uniform1i(s.u.uEnvD,1);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D,texEnvS); gl.uniform1i(s.u.uEnvS,2);
      gl.bindBuffer(gl.ARRAY_BUFFER,craftGL.vb);
      const ST=20;
      gl.enableVertexAttribArray(s.a.aPos);  gl.vertexAttribPointer(s.a.aPos,3,gl.SHORT,false,ST,0);
      gl.enableVertexAttribArray(s.a.aNrm);  gl.vertexAttribPointer(s.a.aNrm,3,gl.BYTE,true,ST,8);
      gl.enableVertexAttribArray(s.a.aMet);  gl.vertexAttribPointer(s.a.aMet,1,gl.UNSIGNED_BYTE,true,ST,11);
      gl.enableVertexAttribArray(s.a.aCol);  gl.vertexAttribPointer(s.a.aCol,3,gl.UNSIGNED_BYTE,true,ST,12);
      gl.enableVertexAttribArray(s.a.aRough);gl.vertexAttribPointer(s.a.aRough,1,gl.UNSIGNED_BYTE,true,ST,15);
      gl.enableVertexAttribArray(s.a.aEmi);  gl.vertexAttribPointer(s.a.aEmi,3,gl.UNSIGNED_BYTE,true,ST,16);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER,craftGL.ib);
      craftGL.hdr.chunks.forEach(c=>gl.drawElements(gl.TRIANGLES,c.in,gl.UNSIGNED_SHORT,c.io*2));
      // attribute 3-5 are craft-only; leave them disabled for the other programs
      [s.a.aMet,s.a.aRough,s.a.aEmi,s.a.aCol].forEach(a=>{ if(a>=0) gl.disableVertexAttribArray(a); });
      gl.enable(gl.BLEND); gl.depthMask(false);

      // rotor glow (front pair mounted low, rear pair high) and the nose lamps
      const ta=thrust.arr;
      const setp=(i2,lx,ly,lz)=>{
        ta[i2*3]  =M[0]*lx+M[4]*ly+M[8]*lz+M[12];
        ta[i2*3+1]=M[1]*lx+M[5]*ly+M[9]*lz+M[13];
        ta[i2*3+2]=M[2]*lx+M[6]*ly+M[10]*lz+M[14];
      };
      setp(0, 2.97,-0.05, 2.96); setp(1, 2.97,-0.05,-2.96);
      setp(2,-2.98, 1.15, 2.76); setp(3,-2.98, 1.15,-2.76);
      setp(4, 3.95, 0.05,-0.55); setp(5, 3.95, 0.05, 0.55);
      up(thrust.pos,thrust.arr);
      gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
      drawPts(thrust,6,{...o,max:30,alpha:0.7,boost:1.5,soft:2.6,near:2,far:600});
      gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    }
    else if(t>0.395 && t<0.905 && cam.craft){
      const cr=cam.craft, roll=cam.roll||0;
      const fx=cr.f[0],fz=cr.f[1],rxx=-fz,rzz=fx;
      const cb=Math.cos(-roll), sb=Math.sin(-roll);
      for(let k=0;k<flyLoc.n;k++){
        let lx=flyLoc.P[k*3], ly=flyLoc.P[k*3+1], lz=flyLoc.P[k*3+2];
        let by=ly*cb-lz*sb, bz=ly*sb+lz*cb;      // bank about the roll axis
        flyer.ap[k*3]  =cr.p[0]+fx*lx+rxx*bz;
        flyer.ap[k*3+1]=cr.p[1]+by;
        flyer.ap[k*3+2]=cr.p[2]+fz*lx+rzz*bz;
        let nx=flyLoc.N[k*3], ny=flyLoc.N[k*3+1], nz=flyLoc.N[k*3+2];
        const ny2=ny*cb-nz*sb, nz2=ny*sb+nz*cb;
        flyer.an[k*3]  =fx*nx+rxx*nz2;
        flyer.an[k*3+1]=ny2;
        flyer.an[k*3+2]=fz*nx+rzz*nz2;
      }
      up(flyer.pos,flyer.ap); up(flyer.nrm,flyer.an);
      gl.disable(gl.BLEND); gl.depthMask(true);
      drawSolid(flyer,flyer.n,{...o,spec:1.45,cityI:4.2,emit:0.105,near:2,far:900});
      gl.enable(gl.BLEND); gl.depthMask(false);
      // thruster cores, their wash, and the nose lamps
      const ta=thrust.arr;
      const setp=(i2,lx,ly,lz)=>{
        const by=ly*cb-lz*sb, bz=ly*sb+lz*cb;
        ta[i2*3]=cr.p[0]+fx*lx+rxx*bz; ta[i2*3+1]=cr.p[1]+by; ta[i2*3+2]=cr.p[2]+fz*lx+rzz*bz;
      };
      setp(0,-4.05,0.34,-1.62); setp(1,-4.05,0.34,1.62);
      setp(2,-5.30,0.34,-1.62); setp(3,-5.30,0.34,1.62);
      setp(4, 4.55,0.16,-0.30); setp(5, 4.55,0.16, 0.30);
      up(thrust.pos,thrust.arr);
      gl.blendFunc(gl.SRC_ALPHA,gl.ONE);
      drawPts(thrust,6,{...o,max:34,alpha:0.85,boost:1.9,soft:3.0,near:2,far:600});
      gl.blendFunc(gl.SRC_ALPHA,gl.ONE_MINUS_SRC_ALPHA);
    }

    /* HUD */
    const pct=Math.round(t*100);
    hud.fill.style.width=pct+'%'; hud.head.style.left=pct+'%'; hud.pct.textContent=pct;
    hud.elev.textContent=String(Math.max(0,Math.round(cam.pos[1]-H(cam.pos[0],cam.pos[2]))));
    hud.hdg.textContent=String(Math.round((Math.atan2(cam.look[0]-cam.pos[0],cam.look[2]-cam.pos[2])*180/Math.PI+360)%360)).padStart(3,'0');
    let floorNow=null;
    if(act.k==='ascent'){ let bd=1e9; floors.forEach(f=>{ const d=Math.abs(cam.pos[1]-f.y); if(d<bd){bd=d;floorNow=f;} }); if(bd>40) floorNow=null; }
    if(hud.act) hud.act.textContent = floorNow ? 'The tower · Floor 0'+(floorNow.k+1) : act.name;
    if(act.k!==titleAct){ titleAct=act.k; if(t<0.988) showTitle(act, act.k==='ascent'?1400:2600); }
    root.classList.toggle('act-ascent',act.k==='ascent');
    hud.station.textContent = act.k==='ascent'?(floorNow?floorNow.name:(t>0.962?'The top':'Climbing')):act.k==='city'?'Over the city':
      act.k==='flight'?'In the air':act.k==='pickup'?'Boarding':
      (nd<0.085&&nearest)?nearest.p.name:'Heading out';
    if(t>0.988){ hud.end.classList.add('on'); if(playing) setPlay(false); }
    else hud.end.classList.remove('on');

    raf=requestAnimationFrame(frame);
  }

  /* one neon spine at a time, so each keeps its own colour */
  function drawLnRange(o,first,count,opt){
    const s=progL; gl.useProgram(s.p);
    gl.uniformMatrix4fv(s.u.uMVP,false,opt.mvp);
    gl.uniform3fv(s.u.uCam,opt.cam);
    gl.uniform3fv(s.u.uCol,opt.col); gl.uniform3fv(s.u.uFog,FOGC);
    gl.uniform1f(s.u.uNear,opt.near==null?NEAR:opt.near);
    gl.uniform1f(s.u.uFar,opt.far==null?FAR:opt.far);
    gl.uniform1f(s.u.uAlpha,opt.alpha);
    gl.uniform1f(s.u.uNF,opt.nf==null?1:opt.nf);
    gl.bindBuffer(gl.ARRAY_BUFFER,o.pos);
    gl.enableVertexAttribArray(s.a.aPos);gl.vertexAttribPointer(s.a.aPos,3,gl.FLOAT,false,0,0);
    gl.drawArrays(gl.LINES,first,count);
  }

  /* ---------- the cue: whatever is nearest, one click or Enter away ---------- */
  const cueEl={ w:document.getElementById('sv-cue'), k:document.getElementById('sv-cue-k'), t:document.getElementById('sv-cue-t') };
  let cueTarget=null, cueLabel=null;
  function setCue(c){
    if(!cueEl.w) return;
    if(cueLabel && (!c || c.el!==cueLabel)){ cueLabel.classList.remove('near'); cueLabel=null; }
    if(!c){ cueTarget=null; cueEl.w.classList.remove('on'); cueEl.w.setAttribute('aria-hidden','true'); return; }
    if(cueEl.t.textContent!==c.t){ cueEl.k.textContent=c.k; cueEl.t.textContent=c.t; }
    cueTarget=c.target; cueEl.w.classList.add('on'); cueEl.w.setAttribute('aria-hidden','false');
    cueLabel=c.el; cueLabel.classList.add('near');
  }
  if(cueEl.w) cueEl.w.addEventListener('click',()=>{ if(cueTarget) openPanel(cueTarget); });

  /* ---------- the panel: a station or a floor, opened in place ---------- */
  const panel={ el:document.getElementById('sv-panel'), k:document.getElementById('sv-panel-k'), t:document.getElementById('sv-panel-t'),
                b:document.getElementById('sv-panel-b'), go:document.getElementById('sv-panel-go'), cont:document.getElementById('sv-panel-continue'),
                x:document.getElementById('sv-panel-x'), timer:document.getElementById('sv-panel-timer') };
  let panelOpen=false, panelResume=false, panelTarget=null;
  const SECTION_ID=['statement','work','experience','capabilities','contact'];
  const FLOOR_SUB=['Who I am','What I have built','Where I have worked','What I work with','Get in touch'];
  function projectHTML(p){
    return `<p class="lede">${esc(p.lede)}</p>`+p.body.map(t=>`<p>${esc(t)}</p>`).join('')+
      `<dl class="specs">${p.specs.map(([k,v])=>`<div class="spec-row"><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join('')}<div class="spec-row"><dt>Context</dt><dd>${esc(p.org)}</dd></div></dl>`+
      `<div class="taglist">${p.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>`;
  }
  function floorHTML(k){
    if(k===0){
      const st=document.querySelector('#statement .statement'), side=[...document.querySelectorAll('#statement .statement-side p')];
      return `<p class="lede">${esc(st?st.textContent.trim().replace(/\s+/g,' '):'')}</p>`+side.map(p=>`<p>${esc(p.textContent)}</p>`).join('');
    }
    if(k===1) return `<div class="plist">${PROJECTS.map(p=>`<button type="button" class="pitem" data-project="${esc(p.id)}"><span class="no">${esc(p.no)}</span><span class="nm">${esc(p.name)}</span><span class="kd">${esc(p.kind)}</span><span class="stt">${esc(p.status)}</span></button>`).join('')}</div><p class="hint">Each one also has a station out on the open ground.</p>`;
    if(k===2) return `<div class="xlist">${EXPERIENCE.map(x=>`<div class="xitem"><span class="when">${esc(x.when)}</span><b>${esc(x.role)}</b><span class="org">${esc(x.org)}</span><p>${esc(x.notes[0])}</p></div>`).join('')}</div>`;
    if(k===3) return DOMAINS.map(d=>`<div class="dom"><b>${esc(d.name)}</b><div class="taglist">${d.skills.map(s=>`<span class="tag">${esc(s)}</span>`).join('')}</div></div>`).join('');
    const em=(document.getElementById('email')||{}).textContent||'';
    return `<p class="lede">Open to work — internships, research roles and interesting problems.</p>
      <dl class="specs"><div class="spec-row"><dt>Email</dt><dd><a href="mailto:${esc(em)}">${esc(em)}</a></dd></div>
      <div class="spec-row"><dt>Phone</dt><dd>+91 8002830837</dd></div>
      <div class="spec-row"><dt>Based in</dt><dd>Faridabad, India · IST</dd></div>
      <div class="spec-row"><dt>GitHub</dt><dd><a href="https://github.com/SHIVAMDWIVEDI06" rel="noopener" target="_blank">SHIVAMDWIVEDI06</a></dd></div>
      <div class="spec-row"><dt>LinkedIn</dt><dd><a href="https://www.linkedin.com/in/shivamdwivediwork2005" rel="noopener" target="_blank">/in/shivamdwivediwork2005</a></dd></div></dl>`;
  }
  function openPanel(target,auto){
    if(!panel.el) return;
    panelTarget=target;
    autoLeaveAt = auto ? performance.now()+AUTO_LEAVE : 0;
    if(panel.timer) panel.timer.style.width='0%';
    panel.el.classList.toggle('auto',!!auto);
    if(target.kind==='project'){
      const p=target.p; panel.k.textContent='Project '+p.no+' · '+p.kind; panel.t.textContent=p.name; panel.b.innerHTML=projectHTML(p);
      panel.go.textContent='Read on the page';
    } else {
      const f=floors[target.k]; panel.k.textContent='Floor 0'+(target.k+1)+' · '+FLOOR_SUB[target.k]; panel.t.textContent=f.name; panel.b.innerHTML=floorHTML(target.k);
      panel.go.textContent='Open this section';
    }
    panelResume = playing || panelResume;
    if(playing) setPlay(false);
    panel.el.classList.add('on'); panel.el.setAttribute('aria-hidden','false'); panelOpen=true;
    root.classList.add('panel-open'); panel.b.scrollTop=0;
  }
  function closePanel(resume){
    if(!panelOpen) return;
    panel.el.classList.remove('on'); panel.el.classList.remove('auto'); panel.el.setAttribute('aria-hidden','true'); panelOpen=false;
    root.classList.remove('panel-open'); autoLeaveAt=0;
    if(panel.cont) panel.cont.textContent='Continue the flight →';
    if(resume && panelResume) setPlay(true);
    panelResume=false;
  }
  const holdPanel=()=>{ if(autoLeaveAt){ autoLeaveAt=0; panel.el.classList.remove('auto'); if(panel.timer) panel.timer.style.width='0%'; if(panel.cont) panel.cont.textContent='Continue the flight →'; } };
  if(panel.el){
    ['pointerdown','wheel','touchstart','focusin'].forEach(ev=>panel.el.addEventListener(ev,holdPanel,{passive:true}));
    panel.b.addEventListener('scroll',holdPanel,{passive:true});
    panel.cont.addEventListener('click',()=>closePanel(true));
    panel.x.addEventListener('click',()=>closePanel(false));
    panel.go.addEventListener('click',()=>{
      const tg=panelTarget; closePanel(false); close();
      if(!tg) return;
      if(tg.kind==='project'){
        const row=document.querySelector(`#index .row[data-project="${tg.p.id}"]`);
        if(row){ if(row.getAttribute('aria-expanded')!=='true') row.click(); setTimeout(()=>row.scrollIntoView({behavior:'smooth',block:'center'}),60); }
      } else {
        const sec=document.getElementById(SECTION_ID[tg.k]); if(sec) setTimeout(()=>sec.scrollIntoView({behavior:'smooth',block:'start'}),60);
      }
    });
    panel.b.addEventListener('click',e=>{ const b=e.target.closest('.pitem'); if(!b) return; const p=PROJECTS.find(q=>q.id===b.dataset.project); if(p) openPanel({kind:'project',p}); });
  }

  /* ---------- input ---------- */
  function advance(d){
    const a=actAt(tTarget).k, sc=a==='ascent'?0.22:a==='city'?0.75:1;   // the tower is climbed slowly, floor by floor
    tTarget=clamp(tTarget+d*sc,0,1); holdUntil=0; if(playing) setPlay(false); if(panelOpen) closePanel(false);
  }
  root.addEventListener('wheel',e=>{ if(e.target.closest('.sv-panel')) return; e.preventDefault();advance(e.deltaY*0.00030);},{passive:false});
  let dragging=false,lastY=0,downAt=null;
  root.addEventListener('pointerdown',e=>{if(e.target.closest('button,.sv-panel,a'))return;dragging=true;lastY=e.clientY;downAt=[e.clientX,e.clientY];});
  root.addEventListener('pointermove',e=>{if(!dragging)return;advance((lastY-e.clientY)*0.0010);lastY=e.clientY;});
  addEventListener('pointerup',e=>{
    if(dragging && downAt && Math.hypot(e.clientX-downAt[0],e.clientY-downAt[1])<6){
      // a tap on the scene: the nearest visible station or floor within reach opens
      let best=null,bd=90;
      [...stations.map(s=>({el:s.el,t:{kind:'project',p:s.p}})),...floors.map(f=>({el:f.el,t:{kind:'floor',k:f.k}}))].forEach(c=>{
        if(parseFloat(c.el.style.opacity||'0')<0.3) return;
        const r=c.el.getBoundingClientRect(); const cx=r.left+r.width/2, cy=r.top+r.height/2;
        const d=Math.hypot(e.clientX-cx,e.clientY-cy)-Math.max(r.width,r.height)/2; if(d<bd){bd=d;best=c.t;}
      });
      if(best) openPanel(best);
    }
    dragging=false; downAt=null;
  });
  addEventListener('keydown',e=>{
    if(!running) return;
    if(e.key==='Escape'){ if(panelOpen){closePanel(false);return;} close();return;}
    if(e.key==='Enter' && !panelOpen && cueTarget && !e.target.closest('button')){ e.preventDefault(); openPanel(cueTarget); return; }
    if(e.key==='ArrowDown'||e.key==='ArrowRight'){e.preventDefault();advance(0.015);}
    if(e.key==='ArrowUp'||e.key==='ArrowLeft'){e.preventDefault();advance(-0.015);}
    if(e.key===' '){e.preventDefault();setPlay(!playing);}
  });
  function setPlay(v){
    playing=v;
    hud.play.setAttribute('aria-pressed',String(v));
    hud.play.textContent=v?'Pause':'Play';
    if(v&&tTarget>0.985){tTarget=0;t=0;}
  }
  hud.play.addEventListener('click',()=>setPlay(!playing));
  document.getElementById('sv-restart').addEventListener('click',()=>{tTarget=0;t=0;holdUntil=0;floors.forEach(f=>f.visited=false);stations.forEach(st=>st.visited=false);setPlay(true);});

  /* published beside the page; each one is optional and has a fallback */
  function loadImg(src){
    return new Promise(res=>{
      const im=new Image(); im.onload=()=>res(im); im.onerror=()=>res(null); im.src=src;
    });
  }
  function loadScript(src,key){
    return new Promise(res=>{
      if(window[key]) return res(window[key]);
      const sc=document.createElement('script');
      sc.onload=()=>res(window[key]||null); sc.onerror=()=>res(null);
      sc.src=src; document.head.appendChild(sc);
    });
  }
  const loadCraft=()=>loadScript('assets/craft.js','__CRAFT');
  const loadBldg=()=>loadScript('assets/bldg.js','__BLDG');
  let assetsLoaded=false;
  function loadAssets(){
    if(assetsLoaded) return Promise.resolve();
    const timeout=new Promise(r=>setTimeout(r,20000));
    const all=Promise.all([
      loadImg('assets/sky.jpg'), loadImg('assets/env_diff.png'), loadImg('assets/env_spec.jpg'), loadCraft(),
      loadBldg(), loadImg('assets/ground_dry.jpg'), loadImg('assets/ground_rock.jpg')
    ]).then(([sky,envD,envS,craft,bldg,gDry,gRock])=>{ ASSET.sky=sky; ASSET.envD=envD; ASSET.envS=envS; ASSET.craft=craft; ASSET.bldg=bldg; ASSET.gDry=gDry; ASSET.gRock=gRock; });
    return Promise.race([all,timeout]).then(()=>{ assetsLoaded=true; });
  }

  function open(){
    if(failed) return;
    root.classList.add('on'); root.setAttribute('aria-hidden','false');
    document.body.classList.add('locked'); pauseField=true;
    if(!built){
      boot.classList.remove('hide'); boot.textContent='Loading…';
      loadAssets().then(()=>{
        if(!root.classList.contains('on')) return;
        let ok=false;
        try{ ok=build(); }catch(err){ ok=false; }
        if(!ok){ failed=true; boot.textContent='This part needs WebGL. Everything else on the page works without it.'; return; }
        built=true;
        start();
      });
      return;
    }
    start();
  }
  function start(){
    boot.classList.add('hide'); titleAct=null;
    if(soundOn && audio) audio.play().then(()=>fadeTo(0.7)).catch(()=>{});
    running=true; lastT=performance.now();
    raf=requestAnimationFrame(frame);
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches)
      setTimeout(()=>{ if(running&&t<0.02) setPlay(true); },900);
    document.getElementById('sv-exit').focus();
  }
  function close(){
    running=false; closePanel(false);
    if(audio && soundOn) fadeTo(0,()=>audio.pause());
    if(raf){cancelAnimationFrame(raf);raf=null;}
    setPlay(false);
    root.classList.remove('on'); root.setAttribute('aria-hidden','true');
    document.body.classList.remove('locked'); pauseField=false;
    document.getElementById('survey-band').scrollIntoView({block:'center'});
  }

  /* score: off until asked for, fades in and out, remembered across re-entries */
  let audio=null, soundOn=false, fadeT=null;
  const soundBtn=document.getElementById('sv-sound');
  function fadeTo(v,done){
    clearTimeout(fadeT);
    const step=()=>{ if(!audio) return; const d=v-audio.volume;
      if(Math.abs(d)<0.03){ audio.volume=v; if(done) done(); return; }
      audio.volume+=d*0.18; fadeT=setTimeout(step,60); };
    step();
  }
  function setSound(v){
    soundOn=v; if(soundBtn) soundBtn.setAttribute('aria-pressed',String(v));
    if(v){
      if(!audio){ audio=new Audio('assets/score.mp3'); audio.loop=true; audio.volume=0; audio.preload='auto'; }
      audio.play().then(()=>fadeTo(0.7)).catch(()=>{ setSound(false); });
    } else if(audio){ fadeTo(0,()=>audio.pause()); }
  }
  if(soundBtn) soundBtn.addEventListener('click',()=>setSound(!soundOn));
  addEventListener('keydown',e=>{ if(running && (e.key==='m'||e.key==='M')) setSound(!soundOn); });

  /* warm the assets when the visitor shows interest, so the flight opens at once */
  (function(){
    let warmed=false; const warm=()=>{ if(warmed) return; warmed=true; if('connection' in navigator && navigator.connection && navigator.connection.saveData) return; loadAssets(); };
    ['enter-survey','enter-survey-2'].forEach(id=>{ const b=document.getElementById(id); if(b){ b.addEventListener('pointerenter',warm,{passive:true}); b.addEventListener('focus',warm); } });
    const band=document.getElementById('survey-band');
    if(band && 'IntersectionObserver' in window){ const io2=new IntersectionObserver(es=>{ if(es.some(e=>e.isIntersecting)){ setTimeout(warm,1200); io2.disconnect(); } },{threshold:0.4}); io2.observe(band); }
  })();
  document.getElementById('enter-survey').addEventListener('click',open);
  document.getElementById('enter-survey-2').addEventListener('click',open);
  document.getElementById('sv-exit').addEventListener('click',close);
  document.getElementById('sv-exit-2').addEventListener('click',close);

  return {open,close,seek:(v)=>{tTarget=clamp(v,0,1);t=tTarget;holdUntil=0;if(playing)setPlay(false);},debug:()=>({ground:!!texGDry,env:!!texEnvD,craft:!!craftGL,bldg:!!ASSET.bldg,gDry:!!ASSET.gDry,gRock:!!ASSET.gRock,aniso:!!extAniso,hero:useModelsHero})};
})();
</script>
</body>
</html>

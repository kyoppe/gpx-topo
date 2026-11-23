import type { HtmlInCanvasContext, HtmlInCanvasElement } from './htmlInCanvas';

export type Vec3 = [number, number, number];

export type TextureLayer = { tex: WebGLTexture; w: number; h: number; ready: boolean };

export type DrawItem = {
  tex?: TextureLayer | null;
  O: Vec3;
  ex: Vec3;
  ey: Vec3;
  table?: boolean;
  /** receives the shadows of the terrain and the cards */
  recv?: boolean;
  alpha?: number;
  solid?: Vec3;
  /** surface normal; lit by it when `useNormal`, otherwise lit as if facing up */
  nrm?: Vec3;
  useNormal?: boolean;
  unlit?: boolean;
  /** glows from inside at night, like a backlit key */
  glow?: number;
  /** a soft shadow: a rounded rect inset by `blur` inside a quad of w x h px */
  shade?: { w: number; h: number; blur: number; strength: number };
  /** a solid quad cut to an ellipse: its centre and radii in the quad's uv */
  disc?: [number, number, number, number];
  /** a solid rounded rectangle: horizontal and vertical corner radii in uv */
  round?: [number, number];
  /** a fixed darkening, for faces that should read as turned away even on the flat page */
  dim?: number;
  /** a ring rather than a disc: the share of the radius that is cut out of the middle */
  ring?: number;
  /** a shine on a solid: strength and sharpness */
  spec?: [number, number];
  /**
   * silk hanging from a pole at its right edge (uv x = 1): the simulated cloth (position, normal, uv for each of its
   * nx x ny particles), its size in CSS px (for the weave), and the share of its width that is the heading tape it
   * hangs by. O, ex and ey give the flat frame it would lie in, which its folds are measured from.
   */
  cloth?: { mesh: Float32Array; nx: number; ny: number; px: [number, number]; hoist: number; shadow?: boolean };
};

export type TerrainPass = {
  /** the map as the flat page shows it, hillshade and all */
  tex: TextureLayer | null;
  /** the map the model wears: no hillshade, no contours of its own */
  relief: TextureLayer | null;
  /** 1 shows `tex`, 0 shows `relief` */
  flat: number;
  /** a sharper `relief` of part of the map (uv x0 y0 x1 y1) while zoomed in */
  detail: { tex: TextureLayer; rect: [number, number, number, number] } | null;
  lift: number;
  contour: number;
  /** the elevation (m) whose contour glows under the pointer */
  hover: number | null;
};

export type Scene = {
  vp: Float32Array;
  eye: Vec3;
  sun: Vec3;
  sunCol: Vec3;
  amb: Vec3;
  expo: number;
  light: number;
  night: number;
  lamps: Float32Array;
  /** map origin x, y and size w, h (world px) */
  map: [number, number, number, number];
  page: [number, number, number, number];
  rects: { r: [number, number, number, number]; z: number }[];
  terrain: TerrainPass | null;
  opaque: DrawItem[];
  blend: DrawItem[];
  /** drawn last, over everything, with its own depth */
  hud: DrawItem[];
  /**
   * The projection the HUD pass is drawn with: the scene's view and field of view, so every HUD point lands on the
   * same pixel, with near and far planes fitted to the HUD. The scene's own planes may be far apart (a camera at eye
   * level), which leaves a depth buffer too coarse to order the layers of the HUD. The scene's `vp` when absent.
   */
  hudVp?: Float32Array;
  hudLight: number;
  dpr: number;
  /** what casts a shadow from the sun onto everything under it (the flag): a cloth mesh and some quads */
  casters?: { cloth?: { mesh: Float32Array; nx: number; ny: number }; quads: DrawItem[] } | null;
};

const COMMON = `
uniform vec3 uSun, uSunCol, uAmb, uEye;
uniform float uLight, uExpo, uNight, uDpr, uHud;
uniform vec4 uLamp[4];
uniform vec2 uRes;
uniform vec4 uMap;            // map origin xy, 1/width, 1/height (world px)
uniform vec2 uMapPx;          // map width, height
uniform vec4 uPage;           // page rect x0 y0 x1 y1
uniform vec4 uRect[8]; uniform float uRectZ[8]; uniform int uRectN;
uniform sampler2D uH, uHB;    // metres above the floor, and a blurred copy
uniform vec2 uHS, uHO;        // map uv -> height texel centres (lattice nodes sit on the map edges)
uniform float uLift, uBaseZ, uPerM, uTopM, uHasH;
vec2 hUV(vec2 uv){ return uv*uHS+uHO; }

float h21(vec2 p){ uvec2 q=uvec2(ivec2(floor(p)))*uvec2(1597334673u,3812015801u); uint n=(q.x^q.y)*1597334673u; return float(n>>8)*(1.0/16777216.0); }
float vn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1.0,0.0)),f.x),mix(h21(i+vec2(0.0,1.0)),h21(i+vec2(1.0,1.0)),f.x),f.y); }
float edgeOcc(float d, float h){ return 0.5*(1.0-d/sqrt(d*d+h*h+1e-3)); }
float rbox(vec2 p, vec4 r, float rad){ vec2 c=(r.xy+r.zw)*0.5, h=(r.zw-r.xy)*0.5; vec2 a=abs(p-c)-h+rad; return length(max(a,0.0))+min(max(a.x,a.y),0.0)-rad; }
vec3 shoulder(vec3 c){ vec3 x=max(c-0.70,0.0); return min(c,0.70)+0.275*(1.0-exp(-x/0.275)); }

float tzAt(vec2 uv){ return uLift*(uBaseZ+texture(uH,hUV(uv)).r*uPerM); }
// march toward the sun over the height field; the model shades itself, the page and the table
uniform highp sampler2DShadow uFS; uniform mat4 uFVP; uniform float uFOn;
// The flag's shadow, from one depth map drawn from the sun, so it has one tone however its folds overlap and falls on
// the ground as it is: 1 = lit, 0 = in its shadow, a little soft at the edge.
float flagLit(vec3 P){
  if(uFOn<0.5) return 1.0;
  vec4 c=uFVP*vec4(P,1.0); vec3 s=c.xyz/c.w*0.5+0.5;
  if(s.x<0.0||s.y<0.0||s.x>1.0||s.y>1.0||s.z>1.0) return 1.0;
  float sum=0.0; vec2 tx=vec2(1.4/2048.0);
  for(int i=-1;i<=1;i++) for(int j=-1;j<=1;j++) sum+=texture(uFS,vec3(s.xy+vec2(float(i),float(j))*tx,s.z-0.0015));
  return sum/9.0;
}
float terrainShadow(vec3 P){
  if(uHasH<0.5||uLift<0.02||uHud>0.5) return 1.0;
  float top=uLift*(uBaseZ+uTopM*uPerM)+0.5;
  if(P.z>top) return 1.0;
  float lz=max(uSun.z,0.035), lxy=max(length(uSun.xy),1e-4);
  vec2 d=uSun.xy/lxy; float rise=lz/lxy;
  // only the stretch of the ray over the map and below its top can be blocked: march that, finest where it starts
  vec2 inv=1.0/(d+vec2(d.x>=0.0?1e-5:-1e-5,d.y>=0.0?1e-5:-1e-5));
  vec2 t0=(uMap.xy-P.xy)*inv, t1=(uMap.xy+uMapPx-P.xy)*inv;
  float a=max(max(min(t0.x,t1.x),min(t0.y,t1.y)),1.2);
  float b=min(min(max(t0.x,t1.x),max(t0.y,t1.y)),(top-P.z)/rise);
  if(b<=a) return 1.0;
  // each pixel starts a little apart, so what the steps miss shows as fine grain rather than a staircase
  float j=h21(gl_FragCoord.xy), vis=1.0;
  for(int i=0;i<64;i++){
    float x=(float(i)+j)/64.0;
    float t=a+(b-a)*x*x;
    vec3 Q=vec3(P.xy+d*t,P.z+rise*t);
    vec2 uv=clamp((Q.xy-uMap.xy)*uMap.zw,0.0,1.0);
    // farther from what casts it, the edge of a shadow is softer
    float w=0.5+t*0.032;
    vis=min(vis,smoothstep(-w,w,Q.z-tzAt(uv)));
    if(vis<0.01) break;
  }
  return vis;
}
vec2 cardShadow(vec3 P){
  float vis=1.0, sky=1.0; vec2 d=uSun.xy/max(uSun.z,0.04);
  float dl=length(d); if(dl>0.85) d*=0.85/dl;
  for(int i=0;i<8;i++){
    if(i>=uRectN) break;
    float dz=uRectZ[i]-P.z; if(dz<=0.3) continue;
    float sd=rbox(P.xy+d*dz,uRect[i],12.0);
    float pen=3.0+dz*0.30;
    float t=1.0-smoothstep(-pen,pen,sd);
    vis*=1.0-(0.46/(1.0+dz*0.006))*t*t*(3.0-2.0*t);
    sky*=1.0-0.42*edgeOcc(rbox(P.xy,uRect[i],12.0),dz*0.8+1.0)/(1.0+dz*0.012);
  }
  return vec2(vis,sky);
}
vec3 lampLight(vec3 P, vec3 n){
  vec3 lamp=vec3(0.0);
  for(int i=0;i<4;i++){
    vec3 d=uLamp[i].xyz-P; float r2=dot(d,d);
    float nl=max(dot(n,d)*inversesqrt(r2+1e-3),0.0)*0.8+0.2;
    lamp+=vec3(1.0,0.66,0.32)*uLamp[i].w*nl/(1.0+r2/1500.0);
  }
  return lamp;
}
vec3 grade(vec3 col){
  vec2 vq=gl_FragCoord.xy/uRes-0.5;
  col*=1.0-0.42*dot(vq,vq)*uLight;
  col=mix(col,col*col*(3.0-2.0*col),0.10*uLight);
  return col+(h21(gl_FragCoord.xy)-0.5)*(1.0/255.0)*uLight;
}
`;

const VS = `#version 300 es
layout(location=0) in vec2 aPos;
uniform mat4 uVP; uniform vec3 uO, uEx, uEy;
out vec2 vUV; out vec3 vW;
void main(){ vec3 w=uO+aPos.x*uEx+aPos.y*uEy; vW=w; vUV=aPos; gl_Position=uVP*vec4(w,1.0); }`;

const FS = `#version 300 es
precision highp float;
in vec2 vUV; in vec3 vW;
uniform sampler2D uTex;
${COMMON}
uniform float uTable, uRecv, uA2C, uAlpha, uUnlit, uUseN, uGlow, uDim;
uniform vec4 uSolid, uDisc; uniform vec2 uRound, uSpec; uniform vec3 uNrm, uEx, uEy; uniform float uRing;
uniform vec4 uShade;          // soft shadow: quad w, h, blur, strength
out vec4 o;

void main(){
  vec3 P=vW; vec4 t; vec3 alb; float a=1.0; vec3 nS=vec3(0.0);
  if(uShade.x>0.0){
    vec2 q=vUV*uShade.xy; float m=uShade.z*1.2;
    float sd=rbox(q,vec4(m,m,uShade.x-m,uShade.y-m),12.0);
    float k=1.0-smoothstep(-uShade.z,uShade.z,sd);
    o=vec4(vec3(0.0),k*uShade.w*mix(0.55,1.0,uLight)*(1.0-0.5*uNight));
    return;
  }
  float fw=length(fwidth(P.xy));
  float fine=clamp(1.5-fw*0.75,0.0,1.0);
  if(uTable>0.5){
    alb=vec3(0.835,0.843,0.851);
    vec2 g=P.xy/40.0; vec2 q=(fract(g-0.5)-0.5)*40.0;
    float px=max(fw,1e-3);
    float dotm=1.0-smoothstep(1.0-px,1.0+px,length(q));
    vec2 q2=(fract(P.xy/200.0-0.5)-0.5)*200.0; vec2 aq=abs(q2);
    float cross_=(1.0-smoothstep(0.55-px*0.5,0.55+px*0.5,min(aq.x,aq.y)))*(1.0-smoothstep(7.0,8.0,max(aq.x,aq.y)));
    float fade=1.0/(1.0+fw*fw*0.9);
    alb*=1.0-(0.10*dotm*(1.0-cross_)+0.12*cross_)*fade;
    float tg=(vn(P.xy*0.9)-0.5)*fine+(vn(P.xy*vec2(0.035,0.5))-0.5)*0.35+(vn(P.xy*0.004)-0.5)*0.5;
    alb*=1.0+tg*0.018;
    float pool=exp(-dot(P.xy-(uPage.xy+uPage.zw)*0.5,P.xy-(uPage.xy+uPage.zw)*0.5)/(1500.0*1500.0));
    alb*=mix(vec3(1.0),vec3(0.30,0.355,0.44)*(0.74+0.62*pool),uLight)*mix(1.0,0.62,uNight*uLight);
    float sd=rbox(P.xy,uPage,16.0);
    alb*=1.0-0.20*exp(-max(sd,0.0)/7.0)-0.10*exp(-max(sd,0.0)/46.0);
  } else if(uSolid.a>0.5){
    alb=uSolid.rgb;
    if(uRound.x>0.0&&uRound.y>0.0){
      vec2 q=max(abs(vUV-0.5)-vec2(0.5-uRound.x,0.5-uRound.y),0.0)/uRound;
      float d=length(q), aa=max(fwidth(d),0.002);
      if(d>1.0+aa) discard;
      a*=1.0-smoothstep(1.0-aa,1.0+aa,d);
    }
    if(uDisc.z>0.0){
      vec2 d=(vUV-uDisc.xy)/uDisc.zw; float r=dot(d,d);
      if(r>1.0||r<uRing*uRing) discard;
      if(uUseN>0.5){
        // round: a ball, or a ring's tube, bulging towards its normal
        float q=uRing>0.0?(sqrt(r)-uRing)/(1.0-uRing)*2.0-1.0:sqrt(r);
        vec2 dd=uRing>0.0?normalize(d)*q:d;
        nS=normalize(normalize(uEx)*dd.x+normalize(uEy)*dd.y+normalize(uNrm)*sqrt(max(1.0-dot(dd,dd),0.0)));
      } else alb*=0.9+0.1*sqrt(1.0-r);
    }
  } else {
    t=texture(uTex,vUV,-0.4); a=t.a;
    if(a<0.004) discard;
    alb=t.rgb/max(a,1e-4);
  }
  vec3 n=dot(nS,nS)>0.0?nS:(uUseN>0.5?normalize(uNrm):vec3(0.0,0.0,1.0));
  float ndl=uUseN>0.5?max(dot(n,uSun),0.0)*0.85+0.15*max(uSun.z,0.0):uSun.z;
  float sun=1.0, ao=1.0;
  if(uRecv>0.5){
    vec2 cs=cardShadow(P);
    sun=terrainShadow(P+vec3(0.0,0.0,0.3))*cs.x*flagLit(P);
    ao=cs.y;
    if(uTable<0.5) alb*=1.0+((vn(P.xy*1.15)-0.5)*fine+(vn(P.xy*vec2(0.11,1.2))-0.5)*0.5*fine)*0.016*uLight;
  } else {
    sun=terrainShadow(P+n*0.5)*flagLit(P+n*0.5);
    if(uUnlit<0.5&&uSolid.a<0.5) alb*=1.0+(vn(P.xy*1.15)-0.5)*fine*0.014*uLight;
  }
  vec3 aoC=pow(vec3(ao),vec3(1.03,1.0,0.955));
  vec3 light=uAmb*aoC+uSunCol*ndl*sun*mix(1.0,ao,0.35)+uSunCol*0.04*(1.0-sun)*(0.4+0.6*ao);
  if(uNight>0.01){
    light+=lampLight(P,n)*uNight*mix(1.0,ao,0.7)*1.9;
    if(uTable<0.5&&uRecv<0.5) light=mix(light,max(light,vec3(0.60,0.61,0.66)),uNight);
  }
  vec3 col=alb*mix(vec3(1.0),light*uExpo,uLight);
  col=mix(col,shoulder(col),uLight);
  if(uUnlit>0.5) col=alb*(1.0+0.35*uNight);
  if(uGlow>0.0) col=mix(col,alb*vec3(1.02,0.97,0.88),uGlow*uNight*uLight);
  if(uSpec.x>0.0){
    vec3 V=normalize(uEye-P), H=normalize(uSun+V);
    col+=uSunCol*uExpo*uSpec.x*pow(max(dot(n,H),0.0),uSpec.y)*sun*uLight*mix(vec3(1.0),alb*1.6,0.5);
  }
  col*=uDim;
  if(uTable>0.5){
    float far=length(P.xy-uEye.xy); col=mix(col,vec3(0.79,0.80,0.81),smoothstep(2200.0,9000.0,far));
  }
  col=grade(col);
  a*=uAlpha;
  if(uA2C>0.5) o=vec4(col,a); else o=vec4(col*a,a);
}`;

// The terrain: one lattice displaced by the height field, plus a skirt down to the page on all four sides.
const TVS = `#version 300 es
layout(location=0) in vec2 aG;     // lattice position, 0..1 across the map
layout(location=1) in vec3 aS;     // skirt: 1 for the bottom row, and the outward normal
uniform mat4 uVP; uniform sampler2D uH;
uniform vec4 uMap; uniform vec2 uMapPx; uniform vec2 uHS, uHO;
uniform float uLift, uBaseZ, uPerM;
out vec3 vW; out vec2 vUV; out vec3 vS;
void main(){
  float z=uLift*(uBaseZ+textureLod(uH,aG*uHS+uHO,0.0).r*uPerM)+0.06;
  if(aS.x>0.5) z=0.0;
  vec3 w=vec3(uMap.xy+aG*uMapPx,z);
  vW=w; vUV=aG; vS=aS;
  gl_Position=uVP*vec4(w,1.0);
}`;

const TFS = `#version 300 es
precision highp float;
in vec3 vW; in vec2 vUV; in vec3 vS;
uniform sampler2D uTex, uRel, uDet;
${COMMON}
uniform vec4 uDetR;           // detail picture: uv x0 y0 x1 y1 (x1 > x0 when there is one)
uniform vec2 uHT;             // height field texel size (uv)
uniform float uBaseEle, uContour, uHover, uFlat;
out vec4 o;

void main(){
  vec3 P=vW; vec3 alb; vec3 n; float ao=1.0;
  bool wall=dot(vS.yz,vS.yz)>0.25;
  bool sea=false;
  float ha;
  if(!wall){
    vec4 t=texture(uTex,vUV,-0.5);
    vec3 flatAlb=t.a>0.01?t.rgb/t.a:vec3(0.93,0.93,0.91);
    vec4 r=texture(uRel,vUV,-0.5);
    alb=r.a>0.01?r.rgb/r.a:flatAlb;
    if(uDetR.z>uDetR.x){
      vec2 q=(vUV-uDetR.xy)/(uDetR.zw-uDetR.xy);
      if(q.x>0.0&&q.y>0.0&&q.x<1.0&&q.y<1.0){
        vec4 d=texture(uDet,q,-0.5);
        vec2 e=min(q,1.0-q)*(uDetR.zw-uDetR.xy)*uMapPx;
        float edge=smoothstep(0.0,6.0,min(e.x,e.y));
        if(d.a>0.01) alb=mix(alb,d.rgb/d.a,clamp(d.a*edge,0.0,1.0));
      }
    }
    alb=mix(alb,flatAlb,uFlat);
    vec2 tc=hUV(vUV);
    float hm=texture(uH,tc).r;
    ha=uBaseEle+hm;
    if(uBaseEle<0.0&&ha<=0.5){
      // DEM sea is zero: keep the source map colour and do not make the water read as terrain
      sea=true;
      alb=flatAlb;
      n=vec3(0.0,0.0,1.0);
    } else {
      float s=uLift*uPerM;
      // light falls on the slope of a few lattice steps around, not on every ripple: the contours carry the fine shape
      vec2 o=uHT*2.5;
      float h00=texture(uH,tc-o).r, h10=texture(uH,tc+vec2(0.0,-o.y)).r, h20=texture(uH,tc+vec2(o.x,-o.y)).r;
      float h01=texture(uH,tc+vec2(-o.x,0.0)).r, h21=texture(uH,tc+vec2(o.x,0.0)).r;
      float h02=texture(uH,tc+vec2(-o.x,o.y)).r, h12=texture(uH,tc+vec2(0.0,o.y)).r, h22=texture(uH,tc+o).r;
      float gx=((h20+2.0*h21+h22)-(h00+2.0*h01+h02))*s/(8.0*o.x*uMapPx.x);
      float gy=((h02+2.0*h12+h22)-(h00+2.0*h10+h20))*s/(8.0*o.y*uMapPx.y);
      n=normalize(vec3(-gx,-gy,1.0));
      // valleys a little darker, ridges a little lighter (in metres, so it does not depend on the scale)
      float cav=texture(uHB,vUV).r-hm;
      ao=1.0-(0.30*smoothstep(0.0,140.0,cav)-0.05*smoothstep(0.0,140.0,-cav))*uLift;
      // contours: every 10 m, every 50 m heavier; each set fades out before its lines run together
      float fw=max(fwidth(ha),1e-5);
      float sMin=10.0/fw, sMaj=50.0/fw;
      float dMin=abs(fract(ha/10.0+0.5)-0.5)*sMin;
      float dMaj=abs(fract(ha/50.0+0.5)-0.5)*sMaj;
      float wMin=0.32*uDpr, wMaj=0.62*uDpr;
      float cmin=(1.0-smoothstep(wMin-0.5,wMin+0.7,dMin))*smoothstep(3.5,7.0,sMin/uDpr);
      float cmaj=(1.0-smoothstep(wMaj-0.5,wMaj+0.7,dMaj))*smoothstep(2.2,4.5,sMaj/uDpr);
      float ink=max(cmin*0.34,cmaj*0.62)*uContour;
      alb=mix(alb,vec3(0.47,0.33,0.20),ink);
    }
  } else {
    n=normalize(vec3(vS.yz,0.0));
    float hz=(P.z/max(uLift,1e-3)-uBaseZ)/uPerM;
    ha=uBaseEle+hz;
    alb=vec3(0.84,0.80,0.73);
    float fw=max(fwidth(ha),1e-5);
    float sp=100.0/fw;
    float d=abs(fract(ha/100.0+0.5)-0.5)*sp;
    alb*=1.0-0.16*(1.0-smoothstep(0.4*uDpr-0.4,0.4*uDpr+0.7,d))*smoothstep(2.0,4.0,sp/uDpr);
    if(hz<0.0) alb*=0.92;
    alb*=1.0+(vn(vec2(dot(P.xy,vec2(0.31,0.23)),P.z*1.9))-0.5)*0.05;
  }
  if(sea){
    o=vec4(alb,1.0);
    return;
  }
  float ndl=max(dot(n,uSun),0.0);
  float sun=terrainShadow(P+n*0.6)*cardShadow(P).x*flagLit(P+n*0.3);
  vec3 aoC=pow(vec3(ao),vec3(1.03,1.0,0.955));
  vec3 light=uAmb*aoC*(0.82+0.18*n.z)+uSunCol*ndl*sun*mix(1.0,ao,0.35)+uSunCol*0.04*(1.0-sun)*(0.4+0.6*ao);
  if(uNight>0.01) light+=lampLight(P,n)*uNight*mix(1.0,ao,0.7)*1.9;
  vec3 col=alb*mix(vec3(1.0),light*uExpo,uLight);
  col=mix(col,shoulder(col),uLight);
  if(!wall&&uHover>-9000.0){
    float d=abs(ha-uHover)/max(fwidth(ha),1e-5);
    float g=1.0-smoothstep(0.45*uDpr,1.3*uDpr,d);
    float halo=1.0-smoothstep(0.8*uDpr,3.5*uDpr,d);
    col=mix(col,vec3(1.0,0.56,0.12),g*0.88*uContour);
    col+=vec3(1.0,0.7,0.3)*0.07*halo*uContour;
  }
  o=vec4(grade(col),1.0);
}`;

type Program = { p: WebGLProgram; u: Record<string, WebGLUniformLocation | null> };

// Silk, hemmed all round: the cloth simulation's own surface, lit as silk is. A soft wrapped diffuse, a sharp sheen
// along the threads, what it mirrors of the sky, and darker hollows where it folds away.
const CVS = `#version 300 es
layout(location=0) in vec3 aP;
layout(location=1) in vec3 aN;
layout(location=2) in vec2 aUV;
uniform mat4 uVP; uniform vec3 uO, uEx, uEy;
out vec2 vUV; out vec3 vW; out vec3 vN; out float vD;
void main(){
  // how far this bit of cloth stands off the flat it would lie in, for the hollows between the folds
  vD=dot(aP-uO,normalize(cross(uEx,uEy)))/max(length(uEy)*0.08,1e-3);
  vN=normalize(aN); vW=aP; vUV=aUV; gl_Position=uVP*vec4(aP,1.0);
}`;

const CFS = `#version 300 es
precision highp float;
in vec2 vUV; in vec3 vW; in vec3 vN; in float vD;
uniform sampler2D uTex;
${COMMON}
uniform vec4 uCloth; uniform vec2 uPx; uniform vec3 uEx, uEy; uniform float uA2C, uAlpha;
uniform float uSide;          // which way the printed face looks: 1 along the cloth's normal, -1 against it
uniform float uShadow;        // 1: the mesh is the cloth's shadow laid on the ground, drawn as a plain darkening
out vec4 o;
void main(){
  if(uShadow>0.5){ o=vec4(0.0,0.0,0.0,uAlpha); return; }
  vec2 px=vUV*uPx;
  float a=1.0;
  float hoist=1.0-uCloth.w;
  vec3 alb; float shine=1.0, rough=0.0;
  vec3 n=normalize(vN);
  vec3 V=normalize(uEye-vW);
  // the print is on the front; from behind there is the bare black silk, with only a faint, blurred bleed of the ink
  bool back=dot(n,V)*uSide<0.0;
  if(dot(n,V)<0.0) n=-n;
  vec4 t=texture(uTex,vUV,-0.6);
  alb=t.rgb/max(t.a,1e-4);
  if(back){
    vec4 b=texture(uTex,vUV,4.0);
    alb=mix(vec3(0.071,0.078,0.09),b.rgb/max(b.a,1e-4),0.07);
  }
  vec3 ex=normalize(uEx), ey=normalize(uEy);
  // the weave: fine threads either way, faded out before they would shimmer
  float fx=fwidth(px.x), fy=fwidth(px.y);
  float wv=clamp(1.6-max(fx,fy)*1.6,0.0,1.0);
  float wx=sin(px.x*2.4), wy=sin(px.y*2.4);
  alb*=1.0+0.05*wv*wx*wy;
  n=normalize(n+(ex*cos(px.x*2.4)+ey*cos(px.y*2.4))*0.05*wv);
  // the heading tape it hangs by: heavy canvas, stitched down, with a brass grommet at either end
  if(vUV.x>hoist){
    float b=(vUV.x-hoist)/uCloth.w;
    alb=vec3(0.80,0.77,0.69)*(0.94+0.06*vn(px*vec2(0.9,0.25)))*(1.0+0.05*sin(px.y*3.1)*wv);
    shine=0.25; rough=1.0;
    float st=abs(px.x-(hoist*uPx.x+2.5));
    if(st<0.7&&fract(px.y/6.0)<0.6) alb*=0.55;
    vec2 g=vec2((hoist+uCloth.w*0.5)*uPx.x, 0.0);
    float gr=uCloth.w*uPx.x*0.3;
    for(int i=0;i<2;i++){
      g.y=i==0?gr*1.7:uPx.y-gr*1.7;
      float d=length(px-g);
      if(d<gr*0.55) discard;
      if(d<gr){
        alb=vec3(0.78,0.6,0.3); shine=2.2;
        vec2 r=(px-g)/gr; float q=(length(r)-0.55)/0.45*2.0-1.0;
        n=normalize(n+(ex*r.x+ey*r.y)/max(length(r),1e-3)*q*0.8);
      }
    }
  } else {
    // hems: the edges are turned under and stitched
    float hm=min(min(px.y,uPx.y-px.y),px.x);
    if(hm<7.0){ alb*=0.86; if(abs(hm-4.5)<0.6&&fract(px.x/5.0)<0.6) alb*=0.6; }
  }
  vec3 L=normalize(uSun), H=normalize(L+V);
  float sun=terrainShadow(vW+n*0.6);
  float wrap=max((dot(n,L)+0.4)/1.4,0.0);
  // silk: a broad sheen and a sharp one, stretched along the threads, and a glow at grazing angles
  float th=dot(ex,H); float along=pow(sqrt(max(1.0-th*th,0.0)),70.0);
  float sharp=pow(max(dot(n,H),0.0),90.0);
  float broad=pow(max(dot(n,H),0.0),12.0);
  float fres=pow(1.0-max(dot(n,V),0.0),4.0);
  float hollow=0.78+0.22*smoothstep(-1.0,0.8,vD*sign(dot(normalize(cross(uEx,uEy)),V)));
  vec3 light=uAmb*hollow+uSunCol*wrap*sun*hollow;
  if(uNight>0.01) light+=lampLight(vW,n)*uNight*1.6;
  vec3 col=alb*light*uExpo;
  vec3 tint=mix(vec3(1.0),alb,0.25)*mix(1.0,0.2,rough);
  col+=uSunCol*uExpo*tint*sun*shine*(0.55*sharp+0.18*broad+0.22*along*(1.0-rough));
  col+=uAmb*fres*0.35*shine;
  // what the silk mirrors: a soft sky above, the ground below, and the long bright streaks of the sky's light down
  // each fold, as a studio light would draw them
  vec3 R=reflect(-V,n);
  vec3 env=mix(vec3(0.16,0.17,0.19),vec3(0.78,0.81,0.86),smoothstep(-0.25,0.75,R.z));
  float streak=pow(max(dot(R,normalize(vec3(-0.25,0.35,0.9))),0.0),24.0)+0.6*pow(max(dot(R,normalize(vec3(0.5,-0.6,0.62))),0.0),40.0);
  col+=(env*(0.06+0.5*fres)+vec3(1.0,0.98,0.95)*streak*0.55)*shine*(1.0-rough)*mix(1.0,0.75,uNight)*uExpo;
  col=mix(alb,col,uLight);
  col=mix(col,shoulder(col),uLight);
  col=grade(col);
  a*=uAlpha;
  if(uA2C>0.5) o=vec4(col,a); else o=vec4(col*a,a);
}`;

// The flag drawn from the sun, depth only, for its shadow.
const SVS_QUAD = `#version 300 es
layout(location=0) in vec2 aPos;
uniform mat4 uVP; uniform vec3 uO, uEx, uEy;
void main(){ gl_Position=uVP*vec4(uO+aPos.x*uEx+aPos.y*uEy,1.0); }`;
const SVS_MESH = `#version 300 es
layout(location=0) in vec3 aP;
uniform mat4 uVP;
void main(){ gl_Position=uVP*vec4(aP,1.0); }`;
const SFS = `#version 300 es
precision mediump float;
out vec4 o;
void main(){ o=vec4(1.0); }`;

export type Renderer = ReturnType<typeof createRenderer>;

export function createRenderer(canvas: HtmlInCanvasElement) {
  const context = canvas.getContext('webgl2', {
    alpha: false,
    antialias: true,
    depth: true,
    stencil: false,
    preserveDrawingBuffer: false,
    powerPreference: 'high-performance',
  }) as HtmlInCanvasContext | null;
  if (!context) throw new Error('WebGL2 is unavailable.');
  const gl: HtmlInCanvasContext = context;

  const shader = (type: number, source: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, source);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
    return s;
  };
  const program = (vs: string, fs: string): Program => {
    const p = gl.createProgram()!;
    gl.attachShader(p, shader(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link');
    const u: Program['u'] = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS) as number;
    for (let i = 0; i < n; i += 1) {
      const info = gl.getActiveUniform(p, i)!;
      u[info.name.replace('[0]', '')] = gl.getUniformLocation(p, info.name);
    }
    return { p, u };
  };
  const main = program(VS, FS);
  const land = program(TVS, TFS);
  const silk = program(CVS, CFS);
  const castQuad = program(SVS_QUAD, SFS);
  const castMesh = program(SVS_MESH, SFS);
  // the sun's depth map of the flag
  const SHADOW = 2048;
  const shadowTex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, shadowTex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, SHADOW, SHADOW);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
  const shadowFbo = gl.createFramebuffer()!;
  gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, shadowTex, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  const shadowVP = new Float32Array(16);
  let shadowOn = false;
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');
  const maxAniso = aniso ? Math.min(16, gl.getParameter(aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number) : 0;
  const floatLinear = !!gl.getExtension('OES_texture_float_linear');
  const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

  const quad = gl.createVertexArray()!;
  gl.bindVertexArray(quad);
  const quadBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quadBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  // the simulated cloth: its particles as they are this frame (position, normal, uv), joined up as a grid
  const clothVao = gl.createVertexArray()!;
  gl.bindVertexArray(clothVao);
  const clothBuffer = gl.createBuffer();
  const clothIndex = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, clothBuffer);
  for (const [loc, n, at] of [
    [0, 3, 0],
    [1, 3, 12],
    [2, 2, 24],
  ]) {
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, n, gl.FLOAT, false, 32, at);
  }
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, clothIndex);
  let clothCount = 0;
  let clothKey = '';
  const clothGrid = (nx: number, ny: number) => {
    const key = `${nx}x${ny}`;
    if (key === clothKey) return;
    clothKey = key;
    const idx = new Uint16Array((nx - 1) * (ny - 1) * 6);
    let k = 0;
    for (let j = 0; j < ny - 1; j += 1) {
      for (let i = 0; i < nx - 1; i += 1) {
        const a = j * nx + i;
        idx.set([a, a + 1, a + nx, a + 1, a + nx + 1, a + nx], k);
        k += 6;
      }
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, clothIndex);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, idx, gl.STATIC_DRAW);
    clothCount = idx.length;
  };

  const meshVao = gl.createVertexArray()!;
  gl.bindVertexArray(meshVao);
  const meshBuffer = gl.createBuffer();
  const meshIndex = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffer);
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(1);
  gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 20, 8);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIndex);
  gl.bindVertexArray(null);
  let meshCount = 0;
  let meshKey = '';

  const white = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, white);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));

  const heightTexture = () => {
    const t = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, t);
    const filter = floatLinear ? gl.LINEAR : gl.NEAREST;
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, 1, 1, 0, gl.RED, gl.FLOAT, new Float32Array([0]));
    return t;
  };
  const hmap = heightTexture();
  const hblur = heightTexture();
  const height = { has: false, cols: 1, rows: 1, perM: 1, baseEle: 0, baseZ: 0, topM: 0 };

  const putHeights = (t: WebGLTexture, cols: number, rows: number, data: Float32Array) => {
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R32F, cols, rows, 0, gl.RED, gl.FLOAT, data);
  };

  /** Heights in metres on a cols x rows lattice over the map; stored relative to `baseEle`. */
  function setTerrain(values: Float32Array, cols: number, rows: number, perM: number, baseEle: number, baseZ: number) {
    const rel = new Float32Array(values.length);
    let top = 0;
    for (let k = 0; k < values.length; k += 1) {
      rel[k] = values[k] - baseEle;
      if (rel[k] > top) top = rel[k];
    }
    putHeights(hmap, cols, rows, rel);
    // a wide blur on a quarter-size lattice, for valley shading: about 1/80 of the map across
    const bc = Math.max(2, Math.round(cols / 4));
    const br = Math.max(2, Math.round(rows / 4));
    const small = new Float32Array(bc * br);
    const reach = Math.max(2, Math.round(cols / 80));
    for (let j = 0; j < br; j += 1) {
      for (let i = 0; i < bc; i += 1) {
        let sum = 0;
        let n = 0;
        const ci = Math.round(((i + 0.5) / bc) * (cols - 1));
        const cj = Math.round(((j + 0.5) / br) * (rows - 1));
        for (let sy = -4; sy <= 4; sy += 1) {
          for (let sx = -4; sx <= 4; sx += 1) {
            const x = Math.max(0, Math.min(cols - 1, ci + Math.round((sx * reach) / 4)));
            const y = Math.max(0, Math.min(rows - 1, cj + Math.round((sy * reach) / 4)));
            sum += rel[y * cols + x];
            n += 1;
          }
        }
        small[j * bc + i] = sum / n;
      }
    }
    putHeights(hblur, bc, br, small);
    Object.assign(height, { has: true, cols, rows, perM, baseEle, baseZ, topM: top });
  }
  function clearTerrain() {
    putHeights(hmap, 1, 1, new Float32Array([0]));
    putHeights(hblur, 1, 1, new Float32Array([0]));
    Object.assign(height, { has: false, cols: 1, rows: 1, topM: 0 });
  }

  /** A lattice of cols x rows vertices over the map, and the skirt around it. */
  function setMesh(cols: number, rows: number) {
    const key = `${cols}x${rows}`;
    if (key === meshKey) return;
    meshKey = key;
    const skirtN = 2 * (cols + rows) * 2;
    const v = new Float32Array((cols * rows + skirtN) * 5);
    let o = 0;
    const vert = (u: number, w: number, bottom: number, nx: number, ny: number) => {
      v[o++] = u;
      v[o++] = w;
      v[o++] = bottom;
      v[o++] = nx;
      v[o++] = ny;
    };
    for (let j = 0; j < rows; j += 1) for (let i = 0; i < cols; i += 1) vert(i / (cols - 1), j / (rows - 1), 0, 0, 0);
    const idx: number[] = [];
    for (let j = 0; j < rows - 1; j += 1) {
      for (let i = 0; i < cols - 1; i += 1) {
        const a = j * cols + i;
        idx.push(a, a + 1, a + cols, a + 1, a + cols + 1, a + cols);
      }
    }
    const edge = (n: number, at: (k: number) => [number, number], nx: number, ny: number) => {
      const first = o / 5;
      for (let k = 0; k < n; k += 1) {
        const [u, w] = at(k / (n - 1));
        vert(u, w, 0, nx, ny);
        vert(u, w, 1, nx, ny);
      }
      for (let k = 0; k < n - 1; k += 1) {
        const a = first + k * 2;
        idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    };
    edge(cols, (t) => [t, 0], 0, -1);
    edge(cols, (t) => [t, 1], 0, 1);
    edge(rows, (t) => [0, t], -1, 0);
    edge(rows, (t) => [1, t], 1, 0);
    gl.bindVertexArray(meshVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, meshBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, v.subarray(0, o), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, meshIndex);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(idx), gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    meshCount = idx.length;
  }

  function layer(): TextureLayer {
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, maxAniso);
    return { tex, w: 0, h: 0, ready: false };
  }
  function deleteLayer(L: TextureLayer) {
    gl.deleteTexture(L.tex);
  }
  let uploadVerified = false;
  function upload(L: TextureLayer, el: Element, width: number, height: number) {
    const scale = Math.min(1, maxTexture / Math.max(width, height));
    const w = Math.max(1, Math.floor(width * scale));
    const h = Math.max(1, Math.floor(height * scale));
    gl.bindTexture(gl.TEXTURE_2D, L.tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    if (L.w !== w || L.h !== h) {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
      L.w = w;
      L.h = h;
    }
    gl.texElementSubImage2D(gl.TEXTURE_2D, 0, 0, 0, el, { width: w, height: h });
    gl.generateMipmap(gl.TEXTURE_2D);
    // WebGL errors need not throw. Verify the first upload before counting it as painted,
    // then avoid synchronous error checks on subsequent uploads.
    if (!uploadVerified) {
      if (gl.isContextLost() || gl.getError() !== gl.NO_ERROR) {
        throw new Error('HTML-in-Canvas texture upload failed.');
      }
      uploadVerified = true;
    }
    L.ready = true;
  }

  function common(P: Program, S: Scene, light: number, hud: boolean) {
    const u = P.u;
    gl.uniformMatrix4fv(u.uVP, false, S.vp);
    gl.uniform4f(u.uMap, S.map[0], S.map[1], 1 / S.map[2], 1 / S.map[3]);
    gl.uniform2f(u.uMapPx, S.map[2], S.map[3]);
    gl.uniform4fv(u.uPage, S.page);
    gl.uniform3fv(u.uSun, S.sun);
    gl.uniform3fv(u.uSunCol, S.sunCol);
    gl.uniform3fv(u.uAmb, S.amb);
    gl.uniform3fv(u.uEye, S.eye);
    gl.uniform1f(u.uLight, light);
    gl.uniform1f(u.uExpo, S.expo);
    gl.uniform1f(u.uNight, S.night);
    gl.uniform1f(u.uDpr, S.dpr);
    gl.uniform1f(u.uHud, hud ? 1 : 0);
    gl.uniform4fv(u.uLamp, S.lamps);
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    const rr = new Float32Array(32);
    const rz = new Float32Array(8);
    S.rects.slice(0, 8).forEach((r, i) => {
      rr.set(r.r, i * 4);
      rz[i] = r.z;
    });
    gl.uniform4fv(u.uRect, rr);
    gl.uniform1fv(u.uRectZ, rz);
    gl.uniform1i(u.uRectN, Math.min(8, S.rects.length));
    const lift = S.terrain?.lift ?? 0;
    gl.uniform1f(u.uLift, lift);
    gl.uniform1f(u.uBaseZ, height.baseZ);
    gl.uniform1f(u.uPerM, height.perM);
    gl.uniform1f(u.uTopM, height.topM);
    gl.uniform1f(u.uHasH, height.has ? 1 : 0);
    gl.uniform2f(u.uHS, (height.cols - 1) / height.cols, (height.rows - 1) / height.rows);
    gl.uniform2f(u.uHO, 0.5 / height.cols, 0.5 / height.rows);
    gl.uniform1i(u.uH, 1);
    gl.uniform1i(u.uHB, 3);
    gl.uniform1i(u.uFS, 5);
    gl.uniformMatrix4fv(u.uFVP, false, shadowVP);
    gl.uniform1f(u.uFOn, shadowOn ? 1 : 0);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, shadowTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, hmap);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, hblur);
    gl.activeTexture(gl.TEXTURE0);
  }

  /** Draws what casts the flag's shadow into the sun's depth map, framed close round it. */
  function castShadows(S: Scene) {
    const C = S.casters;
    shadowOn = false;
    if (!C || S.sun[2] < 0.02) return;
    const pts: number[][] = [];
    if (C.cloth) for (let q = 0; q < C.cloth.nx * C.cloth.ny; q += 1) pts.push([C.cloth.mesh[q * 8], C.cloth.mesh[q * 8 + 1], C.cloth.mesh[q * 8 + 2]]);
    for (const it of C.quads) for (const [a, b] of [[0, 0], [1, 0], [0, 1], [1, 1]]) pts.push([0, 1, 2].map((i) => it.O[i] + it.ex[i] * a + it.ey[i] * b));
    if (!pts.length) return;
    // the light's frame: z towards the sun, x and y across its beams
    const z = S.sun.map((v) => v / Math.hypot(S.sun[0], S.sun[1], S.sun[2])) as Vec3;
    const ref: Vec3 = Math.abs(z[2]) < 0.99 ? [0, 0, 1] : [1, 0, 0];
    let x: Vec3 = [ref[1] * z[2] - ref[2] * z[1], ref[2] * z[0] - ref[0] * z[2], ref[0] * z[1] - ref[1] * z[0]];
    const xl = Math.hypot(x[0], x[1], x[2]);
    x = x.map((v) => v / xl) as Vec3;
    const y: Vec3 = [z[1] * x[2] - z[2] * x[1], z[2] * x[0] - z[0] * x[2], z[0] * x[1] - z[1] * x[0]];
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (const p of pts) {
      const px = p[0] * x[0] + p[1] * x[1] + p[2] * x[2];
      const py = p[0] * y[0] + p[1] * y[1] + p[2] * y[2];
      const pz = p[0] * z[0] + p[1] * z[1] + p[2] * z[2];
      x0 = Math.min(x0, px); x1 = Math.max(x1, px);
      y0 = Math.min(y0, py); y1 = Math.max(y1, py);
      z0 = Math.min(z0, pz); z1 = Math.max(z1, pz);
    }
    const pad = Math.max(x1 - x0, y1 - y0) * 0.04 + 2;
    x0 -= pad; x1 += pad; y0 -= pad; y1 += pad;
    // deep enough to reach whatever the shadow falls on, however far below
    z0 -= 20000;
    z1 += pad;
    const sx = 2 / (x1 - x0), sy = 2 / (y1 - y0), sz = -2 / (z1 - z0);
    const cx = -(x1 + x0) / (x1 - x0), cy = -(y1 + y0) / (y1 - y0), cz = -(z1 + z0) / (z1 - z0);
    // looking down the beams: depth grows away from the sun
    const m = shadowVP;
    m.set([x[0] * sx, y[0] * sy, z[0] * sz, 0, x[1] * sx, y[1] * sy, z[1] * sz, 0, x[2] * sx, y[2] * sy, z[2] * sz, 0, cx, cy, -cz, 1]);
    gl.bindFramebuffer(gl.FRAMEBUFFER, shadowFbo);
    gl.viewport(0, 0, SHADOW, SHADOW);
    gl.clearDepth(1);
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    gl.colorMask(false, false, false, false);
    gl.useProgram(castQuad.p);
    gl.uniformMatrix4fv(castQuad.u.uVP, false, m);
    gl.bindVertexArray(quad);
    for (const it of C.quads) {
      gl.uniform3fv(castQuad.u.uO, it.O);
      gl.uniform3fv(castQuad.u.uEx, it.ex);
      gl.uniform3fv(castQuad.u.uEy, it.ey);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    if (C.cloth) {
      gl.useProgram(castMesh.p);
      gl.uniformMatrix4fv(castMesh.u.uVP, false, m);
      gl.bindVertexArray(clothVao);
      clothGrid(C.cloth.nx, C.cloth.ny);
      gl.bindBuffer(gl.ARRAY_BUFFER, clothBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, C.cloth.mesh, gl.DYNAMIC_DRAW);
      gl.drawElements(gl.TRIANGLES, clothCount, gl.UNSIGNED_SHORT, 0);
    }
    gl.bindVertexArray(null);
    gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    shadowOn = true;
  }

  function draw(S: Scene) {
    castShadows(S);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0.79, 0.8, 0.81, 1);
    gl.clearDepth(1);
    gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);

    // terrain first: it is most of the picture and hides what is under it
    const T = S.terrain;
    if (T && meshCount > 0 && T.tex?.ready) {
      gl.useProgram(land.p);
      common(land, S, S.light, false);
      const u = land.u;
      gl.uniform1i(u.uTex, 0);
      gl.uniform1i(u.uDet, 2);
      gl.uniform1i(u.uRel, 4);
      gl.activeTexture(gl.TEXTURE2);
      gl.bindTexture(gl.TEXTURE_2D, T.detail?.tex.ready ? T.detail.tex.tex : white);
      gl.activeTexture(gl.TEXTURE4);
      gl.bindTexture(gl.TEXTURE_2D, T.relief?.ready ? T.relief.tex : T.tex.tex);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, T.tex.tex);
      gl.uniform4fv(u.uDetR, T.detail?.tex.ready ? T.detail.rect : [0, 0, 0, 0]);
      gl.uniform1f(u.uFlat, T.flat);
      gl.uniform2f(u.uHT, 1 / height.cols, 1 / height.rows);
      gl.uniform1f(u.uBaseEle, height.baseEle);
      gl.uniform1f(u.uContour, T.contour);
      gl.uniform1f(u.uHover, T.hover ?? -1e9);
      gl.bindVertexArray(meshVao);
      gl.drawElements(gl.TRIANGLES, meshCount, gl.UNSIGNED_INT, 0);
    }

    gl.useProgram(main.p);
    gl.bindVertexArray(quad);
    const u = main.u;
    gl.uniform1i(u.uTex, 0);
    let a2c = true;
    const item = (it: DrawItem) => {
      if (it.tex && !it.tex.ready) return;
      if (it.cloth) {
        const c = it.cloth;
        const su = silk.u;
        gl.useProgram(silk.p);
        gl.bindTexture(gl.TEXTURE_2D, it.tex ? it.tex.tex : white);
        gl.uniform3fv(su.uO, it.O);
        gl.uniform3fv(su.uEx, it.ex);
        gl.uniform3fv(su.uEy, it.ey);
        gl.uniform4f(su.uCloth, 0, 0, 0, c.hoist);
        gl.uniform2f(su.uPx, c.px[0], c.px[1]);
        gl.uniform1f(su.uSide, 1);
        gl.uniform1f(su.uShadow, c.shadow ? 1 : 0);
        gl.uniform1f(su.uAlpha, it.alpha ?? 1);
        gl.uniform1f(su.uA2C, a2c ? 1 : 0);
        gl.bindVertexArray(clothVao);
        clothGrid(c.nx, c.ny);
        gl.bindBuffer(gl.ARRAY_BUFFER, clothBuffer);
        gl.bufferData(gl.ARRAY_BUFFER, c.mesh, gl.DYNAMIC_DRAW);
        gl.drawElements(gl.TRIANGLES, clothCount, gl.UNSIGNED_SHORT, 0);
        gl.bindVertexArray(quad);
        gl.useProgram(main.p);
        return;
      }
      gl.bindTexture(gl.TEXTURE_2D, it.tex ? it.tex.tex : white);
      gl.uniform3fv(u.uO, it.O);
      gl.uniform3fv(u.uEx, it.ex);
      gl.uniform3fv(u.uEy, it.ey);
      gl.uniform1f(u.uTable, it.table ? 1 : 0);
      gl.uniform1f(u.uRecv, it.recv ? 1 : 0);
      gl.uniform1f(u.uAlpha, it.alpha ?? 1);
      gl.uniform1f(u.uUnlit, it.unlit ? 1 : 0);
      gl.uniform1f(u.uUseN, it.useNormal ? 1 : 0);
      gl.uniform1f(u.uGlow, it.glow ?? 0);
      const dc = it.disc ?? [0, 0, 0, 1];
      gl.uniform4f(u.uDisc, dc[0], dc[1], dc[2], dc[3]);
      const rr = it.round ?? [0, 0];
      gl.uniform2f(u.uRound, rr[0], rr[1]);
      gl.uniform1f(u.uRing, it.ring ?? 0);
      const sp = it.spec ?? [0, 1];
      gl.uniform2f(u.uSpec, sp[0], sp[1]);
      gl.uniform1f(u.uDim, it.dim ?? 1);
      gl.uniform3fv(u.uNrm, it.nrm ?? [0, 0, 1]);
      gl.uniform4f(u.uSolid, it.solid?.[0] ?? 0, it.solid?.[1] ?? 0, it.solid?.[2] ?? 0, it.solid ? 1 : 0);
      if (it.shade) gl.uniform4f(u.uShade, it.shade.w, it.shade.h, it.shade.blur, it.shade.strength);
      else gl.uniform4f(u.uShade, 0, 0, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    };
    const pass = (opaque: DrawItem[], blend: DrawItem[]) => {
      gl.disable(gl.BLEND);
      gl.enable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.uniform1f(u.uA2C, 1);
      a2c = true;
      for (const it of opaque) item(it);
      gl.disable(gl.SAMPLE_ALPHA_TO_COVERAGE);
      gl.uniform1f(u.uA2C, 0);
      a2c = false;
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      for (const it of blend) item(it);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    };
    gl.useProgram(silk.p);
    common(silk, S, S.light, false);
    gl.uniform1i(silk.u.uTex, 0);
    gl.useProgram(main.p);
    common(main, S, S.light, false);
    pass(S.opaque, S.blend);
    if (S.hud.length) {
      gl.clear(gl.DEPTH_BUFFER_BIT);
      common(main, S, S.hudLight, true);
      if (S.hudVp) {
        gl.uniformMatrix4fv(main.u.uVP, false, S.hudVp);
        gl.useProgram(silk.p);
        gl.uniformMatrix4fv(silk.u.uVP, false, S.hudVp);
        gl.useProgram(main.p);
      }
      pass(
        S.hud.filter((it) => !it.shade),
        S.hud.filter((it) => !!it.shade),
      );
    }
  }

  function dispose() {
    gl.deleteTexture(white);
    gl.deleteTexture(hmap);
    gl.deleteTexture(hblur);
    gl.deleteBuffer(quadBuffer);
    gl.deleteBuffer(meshBuffer);
    gl.deleteBuffer(meshIndex);
    gl.deleteBuffer(clothBuffer);
    gl.deleteBuffer(clothIndex);
    gl.deleteVertexArray(clothVao);
    gl.deleteVertexArray(quad);
    gl.deleteVertexArray(meshVao);
    gl.deleteProgram(main.p);
    gl.deleteProgram(land.p);
    gl.deleteProgram(silk.p);
    gl.deleteProgram(castQuad.p);
    gl.deleteProgram(castMesh.p);
    gl.deleteTexture(shadowTex);
    gl.deleteFramebuffer(shadowFbo);
  }

  return { gl, setTerrain, clearTerrain, setMesh, layer, deleteLayer, upload, draw, dispose, maxTexture };
}

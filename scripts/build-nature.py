"""Original Blender scenery for Endless Drive: pines (alpine, windswept, snow-dusted,
stunted at the treeline) and a dead tree, two cacti, rocks and boulders, rock
outcrops and a scree field for the mountains and mesas, and three bushes.

Blender --background --factory-startup --python scripts/build-nature.py
All game dimensions use X right, Y up, Z forward; p maps them to Blender.
Tree sections are authored closed solids so impacts need no runtime mesh cutting.
"""
import bpy
import bmesh
import math
import random
import json
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'nature'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete(use_global=False)
for m in list(bpy.data.materials): bpy.data.materials.remove(m)
TAU = math.tau

def p(v): return Vector((v[0], -v[2], v[1]))

def material(name, color, vertex=False, rough=.95):
    m=bpy.data.materials.new(name); m.use_nodes=True; m.diffuse_color=(*color,1)
    bs=m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value=(*color,1); bs.inputs['Roughness'].default_value=rough
    if vertex:
        node=m.node_tree.nodes.new('ShaderNodeVertexColor'); node.layer_name='Color'
        m.node_tree.links.new(node.outputs['Color'],bs.inputs['Base Color'])
    return m

surface=material('Nature_Vertex_Color',(1,1,1),True)
roots=[]; parent=None
def asset(name,loc,kind,variant):
    global parent
    o=bpy.data.objects.new(name,None); bpy.context.collection.objects.link(o); o.location=p(loc)
    o['kind']=kind; o['variant']=variant; o['origin']='ground contact'; roots.append(o); parent=o
    return o

def mesh(name,verts,faces,color,section=0,smooth=False):
    if parent and parent.get('kind')=='tree':
        verts=[(v[0],max(0,v[1]),v[2]) for v in verts]
    data=bpy.data.meshes.new(name); data.from_pydata([p(v) for v in verts],[],faces); data.update()
    bm=bmesh.new(); bm.from_mesh(data); bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces)); bm.to_mesh(data); bm.free()
    o=bpy.data.objects.new(name,data); bpy.context.collection.objects.link(o); o.parent=parent
    o['fragment']=section; data.materials.append(surface)
    colors=data.color_attributes.new(name='Color',type='FLOAT_COLOR',domain='CORNER')
    for face in data.polygons:
        face.use_smooth=smooth
        for loop in face.loop_indices:
            xyz=verts[data.loops[loop].vertex_index]
            col=color(xyz,face.index) if callable(color) else color
            colors.data[loop].color=(*col,1)
    return o

def tube(name,points,radii,color,section=0,n=8,ribs=0):
    verts=[]
    for j,(pos,r) in enumerate(zip(points,radii)):
        # Parallel rings are sufficient for upright stems; curved arms use tangent frames.
        tangent=Vector(points[min(j+1,len(points)-1)])-Vector(points[max(0,j-1)])
        tangent.normalize(); ref=Vector((0,0,1))
        if abs(tangent.dot(ref))>.95: ref=Vector((1,0,0))
        u=tangent.cross(ref).normalized(); v=tangent.cross(u).normalized()
        for i in range(n):
            a=TAU*i/n; rr=r*(1+ribs*(1 if i%2==0 else -1))
            verts.append(tuple(Vector(pos)+rr*(math.cos(a)*u+math.sin(a)*v)))
    faces=[tuple(reversed(range(n)))]
    for j in range(len(points)-1):
        for i in range(n): faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    faces.append(tuple((len(points)-1)*n+i for i in range(n)))
    return mesh(name,verts,faces,color,section)

def mix(a,b,t): return tuple(x*(1-t)+y*t for x,y in zip(a,b))

# Each pine has an exposed fluted trunk, root flare and irregular whorls of
# solid, serrated foliage fans. Needles are suggested by silhouette and color.
for variant,name in enumerate(('Pine_Alpine','Pine_Windswept')):
    asset(name,(-5.8+variant*3.7,0,1.6+variant*.6),'tree',variant)
    rng=random.Random(910+variant)
    lean=.16 if variant==0 else -.42
    bark=(.105,.061,.032)
    def bark_color(v,f):
        shade=.78+(f%7)*.052
        return tuple(x*shade for x in bark)
    for section,(lo,hi) in enumerate(((0,2.25),(2.25,4.5),(4.5,6.42))):
        def radius(h): return .235*(1-h/7.15)+.018
        heights=[lo,(lo+hi)/2,hi]
        tube('Bark / trunk section '+str(section),[(lean*(h/6.8)**1.5,h,.055*math.sin(h)) for h in heights],
             [radius(h) if h>.01 else .31 for h in heights],bark_color,section,n=10,ribs=.09)
    for i in range(5):
        a=i*TAU/5+.2
        tube('Buttress root',[(0,.45,0),(.24*math.cos(a),.13,.24*math.sin(a)),(.48*math.cos(a),.015,.48*math.sin(a))],[.11,.1,.018],bark_color,0,n=5)
    tiers=7
    for tier in range(tiers):
        y=1.62+tier*.68
        extent=(1.78 if variant==0 else 1.63)*(1-tier/(tiers+.8))
        branches=5 if tier<5 else 4
        section=3+min(2,tier//3)
        for j in range(branches):
            angle=TAU*j/branches+tier*1.31+variant*.43+rng.uniform(-.14,.14)
            length=extent*rng.uniform(.82,1.13)
            rise=rng.uniform(.16,.36); bend=rng.uniform(-.12,.12)
            base=Vector((lean*(y/6.8)**1.5,y,.03*math.sin(y)))
            forward=Vector((math.cos(angle),0,math.sin(angle)))
            across=Vector((-math.sin(angle),0,math.cos(angle)))
            if tier<4:
                tube('Exposed branch', [tuple(base+Vector((0,-.11,0))),tuple(base+forward*length*.76+Vector((0,-.09,0)))],[.047,.012],bark_color,section,n=5)
            # Serrations alternate along both sides of the fan.
            outline=[(0,-.08),(.29,-.26),(.42,-.2),(.57,-.32),(.69,-.22),(.85,-.25),(1,0),(.84,.24),(.68,.18),(.56,.32),(.4,.23),(.27,.28)]
            verts=[]
            for along,width in outline:
                height=-.12*along+.06*math.sin(along*math.pi)
                verts.append(tuple(base+forward*(along*length)+across*(width*length+bend*along)+Vector((0,height,0))))
            verts.append(tuple(base+forward*(length*.42)+Vector((0,.4+rise,0))))
            verts.append(tuple(base+forward*(length*.42)+Vector((0,-.21,0))))
            faces=[]
            for k in range(len(outline)):
                faces.extend([(k,(k+1)%len(outline),12),((k+1)%len(outline),k,13)])
            shade=rng.uniform(.88,1.13)
            dark=(.027*shade,.086*shade,.055*shade)
            light=(.085*shade,.22*shade,.12*shade) if variant==0 else (.066*shade,.19*shade,.133*shade)
            def foliage_color(v,f,base=base,length=length,dark=dark,light=light):
                t=max(0,min(1,(v[1]-base.y+.15)/.8))
                return mix(dark,light,t*.65+.1+(f%3)*.04)
            mesh('Needle fan / tier %d branch %d'%(tier,j),verts,faces,foliage_color,section)
        # Fill central gaps without giving the crown a perfect cone outline.
        tube('Crown shoot',[(lean*(y/6.8)**1.5,y+.04,0),(lean*((y+.77)/6.8)**1.5,y+.8,0)],
             [extent*.26,.017],(.048,.147,.085),section,n=7)
    tube('Green terminal shoot',[(lean*.92,6.23,0),(lean,6.8,0)],[.17,.008],(.06,.18,.105),5,n=7)

# Saguaros use longitudinal rib geometry, rounded growing tips and smooth
# curved elbows. Pale areoles and short thorns are reserved for close views.
for variant,name in enumerate(('Cactus_Saguaro','Cactus_Forked')):
    asset(name,(2.2+variant*3.7,0,1.6+variant*.3),'cactus',variant)
    rng=random.Random(311+variant)
    def cactus_color(v,f):
        # One material and vertex colors keep ribs, scars and needles in one draw.
        shade=.85+(f%4)*.072
        return tuple(x*shade for x in ((.135,.27,.09) if variant==0 else (.13,.245,.13)))
    h=4.42 if variant==0 else 3.92
    stem=[(0,-.07,0),(.018,.18,0),(.03,h*.5,.025),(0,h-.25,.018),(0,h-.09,.018),(0,h,.018)]
    tube('Ribbed central stem',stem,[.32,.365,.337,.30,.235,.05],cactus_color,n=24,ribs=.07)
    arms=[(-1,1.55,1.14,3.1,.06),(1,2.34,1.09,4.02,-.04)] if variant==0 else [(-1,1.34,.85,2.78,.16),(1,1.75,1.08,3.42,-.07),(1,.83,.54,1.97,.67)]
    for j,(side,start,width,top,z) in enumerate(arms):
        path=[(side*.24,start,0),(side*(width-.28),start+.03,z),(side*width,start+.26,z),
              (side*(width+.03),start+.53,z),(side*(width+.03),top-.18,z),(side*(width+.02),top-.055,z),(side*(width+.02),top,z)]
        tube('Upturned ribbed arm '+str(j),path,[.21,.233,.235,.233,.206,.15,.035],cactus_color,n=16,ribs=.07)
    # Tiny raised areoles provide detail without a costly transparent texture.
    for row in range(11):
        y=.3+row*.345
        if y>h-.35: continue
        for j in range(5):
            a=TAU*j/5+row*.04
            center=Vector((math.cos(a)*.35,y,math.sin(a)*.35))
            side=Vector((-math.sin(a)*.018,0,math.cos(a)*.018)); up=Vector((0,.025,0)); normal=Vector((math.cos(a),0,math.sin(a)))
            verts=[tuple(center-side),tuple(center+up),tuple(center+side),tuple(center-up),tuple(center+normal*.025)]
            mesh('Ivory areole',verts,[(0,1,4),(1,2,4),(2,3,4),(3,0,4)],(.47,.49,.26))
            if row%3==0:
                tip=center+normal*.085+Vector((0,.028,0))
                mesh('Short thorn',[tuple(center-side*.28),tuple(center+side*.28),tuple(tip)],[(0,1,2)],(.37,.32,.17))
    # Woody base with narrow plates, kept beneath the green stem.
    for j in range(6):
        a=TAU*j/6
        v=[(.348*math.cos(a-.12),-.025,.348*math.sin(a-.12)),(.348*math.cos(a+.12),-.025,.348*math.sin(a+.12)),(.355*math.cos(a),.29+rng.random()*.18,.355*math.sin(a))]
        mesh('Weathered base scar',v,[(0,1,2)],(.25,.20,.09))

# Broken, asymmetric stone profiles with broad readable planes and smaller
# mineral facets. Low rings settle into the terrain instead of balancing on a point.
def stone(name,width,height,depth,seed,palette,offset=(0,0,0),moss=False,tilt=0):
    rng=random.Random(seed); n=9; verts=[]
    angles=[TAU*i/n+rng.uniform(-.095,.095) for i in range(n)]
    for ring,(y,r) in enumerate([(-.095,.68),(.12,.98),(.64,.89),(.9,.61),(1,.32)]):
        for i,a in enumerate(angles):
            jitter=rng.uniform(.83,1.14)
            xx=math.cos(a)*width*r*jitter+(ring*.046-.075)*width
            zz=math.sin(a)*depth*r*jitter+math.sin(ring)*depth*.09
            yy=y*height+rng.uniform(-.045,.045)*height if ring else y*height
            if tilt: xx,yy=xx*math.cos(tilt)-yy*math.sin(tilt),xx*math.sin(tilt)+yy*math.cos(tilt)
            verts.append((offset[0]+xx,offset[1]+yy,offset[2]+zz))
    faces=[tuple(reversed(range(n)))]
    for ring in range(4):
        for i in range(n):
            a=ring*n+i; b=ring*n+(i+1)%n; c=(ring+1)*n+(i+1)%n; d=(ring+1)*n+i
            faces.extend([(a,b,c),(a,c,d)])
    faces.append(tuple(4*n+i for i in range(n)))
    def stone_color(v,f):
        t=(f*17%23)/23
        col=mix(palette[0],palette[1],t)
        if moss and v[1]>.55*height and f%6 in (0,1): col=mix(col,(.14,.19,.075),.55)
        return col
    mesh(name,verts,faces,stone_color)

for variant,name in enumerate(('Rock_Granite','Rock_Shale')):
    asset(name,(-5.3+variant*3.4,0,4.45),'rock',variant)
    palette=((.19,.225,.22),(.36,.39,.355)) if variant==0 else ((.15,.16,.15),(.32,.305,.26))
    stone('Weathered stone',.86,.60,.67,517+variant,palette,moss=variant==0)
    stone('Broken companion',.33,.23,.26,817+variant,palette,(.74,0,.29))
    stone('Loose chip',.14,.1,.18,619+variant,palette,(-.67,0,.55))
for variant,name in enumerate(('Boulder_Granite','Boulder_Sandstone')):
    asset(name,(1.6+variant*3.3,0,4.4),'boulder',variant)
    palette=((.19,.22,.205),(.44,.455,.415)) if variant==0 else ((.28,.17,.093),(.54,.38,.215))
    stone('Fractured monolith',1.0,1.72,.78,722+variant,palette,moss=variant==0)
    stone('Spalled foot',.38,.34,.3,875+variant,palette,(.73,0,.29))


# --- Mountains, treeline and drylands -------------------------------------

def blob(name,center,radii,seed,color,section=0):
    """A lumpy closed blob (a jittered icosphere): foliage clumps and shrubs."""
    rng=random.Random(seed)
    bm=bmesh.new(); bmesh.ops.create_icosphere(bm,subdivisions=1,radius=1.0); bm.verts.index_update()
    verts=[]
    for v in bm.verts:
        j=rng.uniform(.8,1.15)
        verts.append((center[0]+v.co.x*radii[0]*j,center[1]+v.co.z*radii[1]*j,center[2]+v.co.y*radii[2]*j))
    faces=[tuple(vv.index for vv in f.verts) for f in bm.faces]; bm.free()
    return mesh(name,verts,faces,color,section)

def conifer(name,variant,loc,seed,height,tiers,lean,extent,snow=0,flagging=0):
    """A pine built like the two above, scaled to any height. snow dusts the
    tops of the needle fans; flagging (krummholz) cuts the branches on the
    windward side, as gales do at the treeline."""
    asset(name,loc,'tree',variant); rng=random.Random(seed)
    s=height/6.8; bark=(.105,.061,.032)
    def bark_color(v,f):
        shade=.78+(f%7)*.052
        return tuple(x*shade for x in bark)
    def trunk(h): return (lean*(h/height)**1.5,h,.055*math.sin(h/s))
    for section,(lo,hi) in enumerate(((0,height*.33),(height*.33,height*.66),(height*.66,height*.945))):
        def radius(h): return (.235*(1-h/(height*1.05))+.018)*max(.8,s)
        heights=[lo,(lo+hi)/2,hi]
        tube('Bark / trunk section '+str(section),[trunk(h) for h in heights],[radius(h) if h>.01 else .31*max(.8,s) for h in heights],bark_color,section,n=10,ribs=.09)
    for i in range(5):
        a=i*TAU/5+.2
        tube('Buttress root',[(0,.45*s,0),(.24*math.cos(a),.13,.24*math.sin(a)),(.48*math.cos(a),.015,.48*math.sin(a))],[.11,.1,.018],bark_color,0,n=5)
    snow_white=(.78,.82,.85)
    for tier in range(tiers):
        y=height*.238+tier*(height*.69/tiers)
        ext=extent*(1-tier/(tiers+.8))
        branches=5 if tier<tiers-2 else 4
        section=3+min(2,tier*3//tiers)
        for j in range(branches):
            angle=TAU*j/branches+tier*1.31+variant*.43+rng.uniform(-.14,.14)
            windward=max(0,math.cos(angle))
            length=ext*rng.uniform(.82,1.13)*(1-flagging*windward*.75)
            rise=rng.uniform(.16,.36)*s; bend=rng.uniform(-.12,.12)
            base=Vector(trunk(y))
            forward=Vector((math.cos(angle),0,math.sin(angle))); across=Vector((-math.sin(angle),0,math.cos(angle)))
            if tier<tiers-3:
                tube('Exposed branch',[tuple(base+Vector((0,-.11,0))),tuple(base+forward*length*.76+Vector((0,-.09,0)))],[.047,.012],bark_color,section,n=5)
            outline=[(0,-.08),(.29,-.26),(.42,-.2),(.57,-.32),(.69,-.22),(.85,-.25),(1,0),(.84,.24),(.68,.18),(.56,.32),(.4,.23),(.27,.28)]
            verts=[]
            for along,width in outline:
                h=-.12*along+.06*math.sin(along*math.pi)
                verts.append(tuple(base+forward*(along*length)+across*(width*length+bend*along)+Vector((0,h,0))))
            verts.append(tuple(base+forward*(length*.42)+Vector((0,(.4+rise)*min(1,s*1.2),0))))
            verts.append(tuple(base+forward*(length*.42)+Vector((0,-.21,0))))
            faces=[]
            for k in range(len(outline)):
                faces.extend([(k,(k+1)%len(outline),12),((k+1)%len(outline),k,13)])
            shade=rng.uniform(.88,1.13)
            dark=(.027*shade,.086*shade,.055*shade); light=(.07*shade,.19*shade,.125*shade)
            def foliage_color(v,f,base=base,dark=dark,light=light):
                t=max(0,min(1,(v[1]-base.y+.15)/.8))
                col=mix(dark,light,t*.65+.1+(f%3)*.04)
                # Snow settles on the upper faces of each fan, thickest at the top.
                if snow and v[1]-base.y>.06: col=mix(col,snow_white,snow*min(1,(v[1]-base.y)*2.2))
                return col
            mesh('Needle fan / tier %d branch %d'%(tier,j),verts,faces,foliage_color,section)
        crown=(.048,.147,.085) if not snow else mix((.048,.147,.085),snow_white,snow*.55)
        tube('Crown shoot',[(trunk(y)[0],y+.04,0),(trunk(y+.77*s)[0],y+.8*s,0)],[ext*.26,.017],crown,section,n=7)
    tube('Green terminal shoot',[(trunk(height*.916)[0],height*.916,0),(lean,height,0)],[.17*max(.8,s),.008],(.06,.18,.105) if not snow else snow_white,5,n=7)

def dead_tree(name,variant,loc,seed):
    """A bare, weathered snag: silver-grey trunk and a few broken limbs."""
    asset(name,loc,'tree',variant); rng=random.Random(seed)
    wood=(.33,.29,.24)
    def wood_color(v,f):
        shade=.72+(f%5)*.07
        return tuple(x*shade for x in wood)
    height=5.8
    def trunk(h): return (.25*(h/height)**1.6,h,.12*math.sin(h*.9))
    for section,(lo,hi) in enumerate(((0,1.9),(1.9,3.8),(3.8,height))):
        heights=[lo,(lo+hi)/2,hi]
        tube('Snag / trunk section '+str(section),[trunk(h) for h in heights],[(.3*(1-h/(height*1.1))+.04) if h>.01 else .4 for h in heights],wood_color,section,n=8,ribs=.14)
    for i in range(4):
        a=i*TAU/4+.5
        tube('Dry root',[(0,.45,0),(.3*math.cos(a),.12,.3*math.sin(a)),(.7*math.cos(a),.01,.7*math.sin(a))],[.14,.11,.02],wood_color,0,n=5)
    for j in range(7):
        y=2.0+j*.5+rng.uniform(-.15,.15)
        a=j*2.4+rng.uniform(-.3,.3); length=rng.uniform(.9,1.7)*(1-j/10)
        base=Vector(trunk(y)); out=Vector((math.cos(a),.0,math.sin(a)))
        tip=base+out*length+Vector((0,length*rng.uniform(.35,.8),0))
        section=3+min(2,j*3//7)
        tube('Broken limb',[tuple(base),tuple(base.lerp(tip,.55)+Vector((0,-.05,0))),tuple(tip)],[.12,.07,.02],wood_color,section,n=5)
        if j%2==0:
            twig=tip+Vector((math.cos(a+.9)*.45,.3,math.sin(a+.9)*.45))
            tube('Twig',[tuple(base.lerp(tip,.7)),tuple(twig)],[.045,.01],wood_color,section,n=4)

for variant,(name,seed,height,tiers,lean,extent,snow,flagging,loc) in enumerate((
        ('Pine_Snow',930,6.6,7,.1,1.7,.85,0,(-6.4,0,9.2)),
        ('Pine_Stunted',940,3.4,4,.55,1.3,.25,.85,(-3.2,0,9.4))),start=2):
    conifer(name,variant,loc,seed,height,tiers,lean,extent,snow,flagging)
dead_tree('Tree_Dead',4,(-.6,0,9.1),960)

# Bushes: a meadow shrub, dry desert scrub and a low alpine juniper cushion.
asset('Bush_Meadow',(2.6,0,9.4),'bush',0); rng=random.Random(970)
for i in range(6):
    a=i*TAU/6+rng.uniform(-.3,.3); r=rng.uniform(.34,.5); d=rng.uniform(.25,.55)
    def leaf(v,f,r=r): t=max(0,min(1,v[1]/1.1)); return mix((.1,.18,.06),(.22,.33,.11),t*.8+(f%4)*.05)
    blob('Leaf clump',(math.cos(a)*d,.32+rng.uniform(0,.32),math.sin(a)*d*.8),(r,r*.85,r),971+i,leaf)
blob('Leaf crown',(0,.72,0),(.5,.42,.46),978,lambda v,f:mix((.12,.21,.07),(.25,.36,.13),.6+(f%4)*.06))
asset('Bush_Desert',(4.9,0,9.4),'bush',1); rng=random.Random(980)
for i in range(7):
    a=i*TAU/7+rng.uniform(-.4,.4); r=rng.uniform(.18,.3); d=rng.uniform(.15,.5)
    blob('Sage clump',(math.cos(a)*d,.25+rng.uniform(0,.35),math.sin(a)*d),(r,r*.8,r),981+i,lambda v,f:mix((.2,.21,.13),(.36,.36,.24),.5+(f%5)*.08))
for i in range(9):
    a=i*TAU/9+.2; reach=rng.uniform(.45,.7)
    tube('Dry twig',[(0,.05,0),(math.cos(a)*reach*.5,.45,math.sin(a)*reach*.5),(math.cos(a)*reach,.75+rng.uniform(0,.2),math.sin(a)*reach)],[.03,.018,.005],(.27,.2,.12),n=4)
asset('Bush_Juniper',(7.3,0,9.4),'bush',2); rng=random.Random(990)
for i in range(5):
    a=i*TAU/5+rng.uniform(-.3,.3); d=rng.uniform(.3,.65)
    blob('Juniper mat',(math.cos(a)*d,.16,math.sin(a)*d),(rng.uniform(.5,.7),.26,rng.uniform(.45,.62)),991+i,lambda v,f:mix((.05,.11,.09),(.11,.2,.15),.45+(f%4)*.1))

# Rock outcrops: crags for the mountains, a layered sandstone ledge for the
# mesas and a tilted slab for the hills. Their bases run a metre or more into
# the ground, so they sit into slopes instead of perching on them.
asset('Outcrop_Granite',(-6.2,0,14.5),'outcrop',0)
granite=((.2,.215,.205),(.43,.44,.41))
stone('Crag spire',1.9,7.2,1.5,1101,granite,(0,-1.4,0))
stone('Crag shoulder',1.6,4.6,1.3,1102,granite,(1.7,-1.2,.5))
stone('Crag buttress',1.3,3.4,1.2,1103,granite,(-1.5,-1.1,-.4))
stone('Fallen block',.8,.9,.7,1104,granite,(2.2,-.2,-1.4))
asset('Outcrop_Sandstone',(.3,0,14.5),'outcrop',1)
# Thin, uneven layers, each offset and a little narrower than the one below.
rng=random.Random(1109); y=-1.3
for k,(w,h) in enumerate(((3.3,1.15),(3.0,.75),(2.9,.9),(2.5,.6),(2.3,.85),(1.8,.55))):
    band=((.4,.21,.105),(.58,.34,.18)) if k%2==0 else ((.5,.29,.15),(.7,.46,.26))
    stone('Sandstone ledge %d'%k,w*rng.uniform(.9,1.08),h,w*rng.uniform(.6,.8),1110+k,band,(rng.uniform(-.35,.35),y,rng.uniform(-.25,.25)))
    y+=h*.78
asset('Outcrop_Slab',(6.8,0,14.5),'outcrop',2)
slate=((.24,.25,.23),(.4,.41,.37))
stone('Tilted slab',2.9,1.0,2.0,1120,slate,(0,.2,0),moss=True,tilt=.42)
stone('Slab step',1.8,.8,1.5,1121,slate,(-1.9,-.25,.6),tilt=.3)

# Scree: a field of loose chips, cheap to draw where slopes shed stone.
asset('Scree_Field',(11.4,0,14.5),'scree',0); rng=random.Random(1130)
for i in range(30):
    a=rng.uniform(0,TAU); d=math.sqrt(rng.random())*3.2; w=rng.uniform(.12,.34); h=w*rng.uniform(.45,.8)
    cx,cz=math.cos(a)*d,math.sin(a)*d; n=5; ring=[]
    for k in range(n):
        b=k*TAU/n+rng.uniform(-.25,.25); rr=w*rng.uniform(.75,1.2)
        ring.append((cx+math.cos(b)*rr,-.05,cz+math.sin(b)*rr*.85))
    ring.append((cx+rng.uniform(-.05,.05)*w,h,cz))
    faces=[tuple(reversed(range(n)))]+[(k,(k+1)%n,n) for k in range(n)]
    tone=rng.uniform(0,1)
    mesh('Scree chip',ring,faces,lambda v,f,tone=tone:mix((.25,.26,.24),(.47,.46,.42),(tone+f*.13)%1))

# Save the editable library and render an asset lineup. Studio props are never exported.
scene=bpy.context.scene; scene.unit_settings.system='METRIC'
scene.render.engine='CYCLES'; scene.cycles.samples=32; scene.cycles.use_denoising=True
scene.render.resolution_x=1800; scene.render.resolution_y=1080; scene.render.resolution_percentage=100
scene.world.color=(.3,.3,.3); scene.view_settings.view_transform='AgX'
bpy.context.preferences.filepaths.save_version=0
floor_mat=material('Studio ground',(.19,.215,.19))
bpy.ops.mesh.primitive_plane_add(size=200); floor=bpy.context.object; floor.name='Studio / ground'; floor.location.z=-.1; floor.data.materials.append(floor_mat)
def area(name,loc,energy,size):
    d=bpy.data.lights.new(name,'AREA'); d.energy=energy; d.shape='DISK'; d.size=size
    o=bpy.data.objects.new(name,d); scene.collection.objects.link(o); o.location=p(loc)
    o.rotation_euler=(p((0,2,2))-o.location).to_track_quat('-Z','Y').to_euler()
area('Warm key',(-5,12,7),2400,8); area('Sky fill',(6,10,2),2100,7); area('Rim',(0,9,-5),2400,6)
d=bpy.data.cameras.new('Nature library camera'); cam=bpy.data.objects.new('Nature library camera',d); scene.collection.objects.link(cam)
cam.location=p((14,15,31)); target=p((1.5,2.4,8)); cam.rotation_euler=(target-cam.location).to_track_quat('-Z','Y').to_euler()
d.type='ORTHO'; d.ortho_scale=30; scene.camera=cam
for screen in bpy.data.screens:
    for area_ui in screen.areas:
        if area_ui.type=='VIEW_3D':
            area_ui.spaces.active.region_3d.view_distance=20
            area_ui.spaces.active.region_3d.view_location=p((0,2,2))
            area_ui.spaces.active.shading.type='MATERIAL'
bpy.ops.object.select_all(action='DESELECT'); roots[0].select_set(True); bpy.context.view_layer.objects.active=roots[0]
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'endless-nature.blend'))
scene.render.filepath=str(OUT/'nature-preview.png'); bpy.ops.render.render(write_still=True)

import sys
sys.path.insert(0,str(ROOT/'scripts'))
from export_nature import export_nature
export_nature(roots,OUT)

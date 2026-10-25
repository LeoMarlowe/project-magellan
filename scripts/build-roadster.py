"""Build the Roadster (Rocket trim, with cold-gas thrusters) with Blender, then export it.

Run: /Applications/Blender.app/Contents/MacOS/Blender --background --factory-startup --python scripts/build-roadster.py
Coordinates below use game axes: X right, Y up, Z forward; p() maps to Blender.
An original low-poly study of the 2026 Roadster's proportions: a faceted wedge
on a 2.825 m wheelbase, 2.0 m wide and 1.1 m tall, with no badges or wordmarks.
Ten thruster nozzles follow the reported Rocket layout: four in the rear
diffuser, four lift nozzles at the corners and two yaw nozzles on the flanks.
Each nozzle has an Exhaust_* empty at its mouth whose 'thrust' property is the
gas direction (game axes); the game hangs its exhaust plumes there. The rear
wing hangs from its own Rear_Wing pivot, which the game tilts to brake.
"""
import bpy
import bmesh
import math
from pathlib import Path
from mathutils import Vector

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'assets' / 'vehicles'
OUT.mkdir(parents=True, exist_ok=True)
bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for block in list(bpy.data.materials):
    bpy.data.materials.remove(block)

WHEELBASE, FRONT_AXLE, REAR_AXLE = 2.82, 1.41, -1.41
# 295/30 R20 front and 335/30 R21 rear: tyre and rim radii, tread widths.
FRONT = dict(radius=.343, rim=.254, width=.295, x=.845)
REAR = dict(radius=.367, rim=.267, width=.335, x=.83)

def p(v):
    return Vector((v[0], -v[2], v[1]))

def mat(name, color, metal=0, rough=.4, emission=0, coat=0):
    m = bpy.data.materials.new(name)
    m.diffuse_color = (*color, 1)
    m.use_nodes = True
    bs = m.node_tree.nodes.get('Principled BSDF')
    bs.inputs['Base Color'].default_value = (*color, 1)
    bs.inputs['Metallic'].default_value = metal
    bs.inputs['Roughness'].default_value = rough
    if emission:
        bs.inputs['Emission Color'].default_value = (*color, 1)
        bs.inputs['Emission Strength'].default_value = emission
    if coat:
        bs.inputs['Coat Weight'].default_value = coat
        bs.inputs['Coat Roughness'].default_value = .18
    return m

paint = mat('Ano_White', (.78, .79, .77), .12, .34, coat=.35)
glass = mat('Gold_Glass', (.06, .04, .014), .8, .1)
carbon = mat('Carbon', (.022, .024, .027), .25, .42)
titanium = mat('Titanium', (.45, .45, .47), .85, .28)
graphite = mat('Wheel_Graphite', (.045, .05, .055), .6, .34)
rubber = mat('Rubber', (.019, .022, .024), 0, .8)
head = mat('Headlamp', (.9, .94, 1), .1, .15, .6)
brake = mat('Brake_Lamp', (.75, .02, .015), .15, .2, .35)
throat = mat('Thruster_Throat', (.012, .012, .014), .3, .85)
caliper = mat('Caliper_Gold', (.72, .5, .16), .85, .3)
strap = mat('Tow_Red', (.62, .035, .025), 0, .6)
lens = mat('Lens_White', (.82, .84, .86), .1, .18)

def empty(name, loc=(0, 0, 0), parent=None):
    o = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(o)
    o.location = p(loc)
    o.parent = parent
    return o

root = empty('Roadster_Rocket')
root['asset'] = 'Roadster Rocket / original Blender study, cold-gas thruster trim'
root['forward'] = '+Z in glTF'; root['wheelRadius'] = (FRONT['radius'] + REAR['radius']) / 2
body = empty('Body', parent=root)
parent = body

def finish(o, name, material, bevel=0, smooth=True):
    o.name = name
    o.parent = parent
    o.data.materials.append(material)
    if bevel:
        mod = o.modifiers.new('Edge radius', 'BEVEL')
        mod.width = bevel; mod.segments = 2
    if smooth:
        for face in o.data.polygons:
            face.use_smooth = True
        mod = o.modifiers.new('Weighted surface normals', 'WEIGHTED_NORMAL')
        mod.keep_sharp = True; mod.weight = 50
    return o

def box(name, loc, size, material, bevel=.012, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(size=1, location=p(loc))
    o = bpy.context.object
    o.dimensions = (size[0], size[2], size[1])
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    # Game Euler X/Y/Z map to Blender X/Z/-Y.
    o.rotation_euler = (rotation[0], -rotation[2], rotation[1])
    return finish(o, name, material, bevel)

def mesh(name, verts, faces, material, bevel=0, smooth=False):
    m = bpy.data.meshes.new(name)
    m.from_pydata([p(v) for v in verts], [], faces); m.update()
    o = bpy.data.objects.new(name, m); bpy.context.collection.objects.link(o)
    # Consistent outward normals for the lofted shells.
    bm = bmesh.new(); bm.from_mesh(m)
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(m); bm.free()
    return finish(o, name, material, bevel, smooth)

def beam(name, a, b, radius, material, vertices=8):
    a, b = p(a), p(b)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=(b-a).length, location=(a+b)/2)
    o = bpy.context.object; o.rotation_euler = (b-a).to_track_quat('Z', 'Y').to_euler()
    return finish(o, name, material, 0)

def cylinder(name, loc, radius, depth, material, axis=(1, 0, 0), vertices=32, bevel=.005, caps=True):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=p(loc), end_fill_type='NGON' if caps else 'NOTHING')
    o = bpy.context.object
    o.rotation_euler = p(axis).to_track_quat('Z', 'Y').to_euler()
    return finish(o, name, material, bevel)

def cone(name, loc, r1, r2, depth, material, axis, vertices=20):
    # r1 at the start of the axis direction, r2 at its end.
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r1, radius2=r2, depth=depth, location=p(loc), end_fill_type='NOTHING')
    o = bpy.context.object
    o.rotation_euler = p(axis).to_track_quat('Z', 'Y').to_euler()
    return finish(o, name, material, 0)

def tube(name, points, radius, material):
    c = bpy.data.curves.new(name, 'CURVE'); c.dimensions = '3D'
    c.bevel_depth = radius; c.bevel_resolution = 1; c.resolution_u = 1
    s = c.splines.new('POLY'); s.points.add(len(points)-1)
    for q, v in zip(s.points, points): q.co = (*p(v), 1)
    o = bpy.data.objects.new(name, c); bpy.context.collection.objects.link(o)
    o.parent = parent; c.materials.append(material)
    return o

def loft(name, rings, material, bevel=.015, smooth=True):
    # Closed surface through same-sized cross-section rings (game coordinates).
    n = len(rings[0]); verts = [v for ring in rings for v in ring]; faces = []
    for j in range(len(rings)-1):
        for k in range(n): faces.append((j*n+k, j*n+(k+1)%n, (j+1)*n+(k+1)%n, (j+1)*n+k))
    faces += [tuple(range(n))[::-1], tuple((len(rings)-1)*n+k for k in range(n))]
    return mesh(name, verts, faces, material, bevel, smooth)

def mirrored(z, half):
    # Half profile from the bottom centre round to the top centre (x >= 0),
    # mirrored into a closed ring at station z.
    right = [(x, y, z) for x, y in half]
    left = [(-x, y, z) for x, y in half[-2:0:-1]]
    return right + left

# ---- Body shell: a faceted wedge lofted through fifteen stations, nose to tail.
# The shoulder rises over each axle, so the wheel arches stay below the crease.
# Each half profile: keel, sill, side crease, shoulder, fender top, deck edge, centre.
BODY = [
    (2.23, [(0, .19), (.62, .19), (.78, .29), (.80, .36), (.74, .42), (.42, .415), (0, .41)]),
    (2.14, [(0, .15), (.80, .15), (.95, .29), (.96, .41), (.89, .51), (.50, .475), (0, .47)]),
    (1.82, [(0, .12), (.86, .12), (1.0, .31), (1.0, .52), (.93, .69), (.53, .575), (0, .565)]),
    (1.66, [(0, .12), (.87, .12), (1.0, .31), (1.0, .66), (.935, .75), (.53, .60), (0, .59)]),
    (1.41, [(0, .12), (.87, .12), (1.0, .32), (1.0, .74), (.935, .80), (.53, .64), (0, .63)]),
    (1.16, [(0, .12), (.87, .12), (1.0, .325), (1.0, .68), (.935, .79), (.54, .67), (0, .665)]),
    (.95, [(0, .12), (.87, .12), (.995, .33), (.995, .58), (.93, .775), (.55, .70), (0, .695)]),
    (.62, [(0, .12), (.86, .12), (.985, .33), (.985, .56), (.91, .77), (.62, .755), (0, .75)]),
    (0, [(0, .12), (.85, .12), (.97, .33), (.975, .56), (.90, .785), (.70, .79), (0, .79)]),
    (-.80, [(0, .12), (.87, .12), (1.0, .34), (1.0, .58), (.94, .80), (.70, .80), (0, .80)]),
    (-1.16, [(0, .12), (.875, .12), (1.0, .345), (1.0, .72), (.95, .815), (.66, .80), (0, .80)]),
    (-1.41, [(0, .13), (.88, .13), (1.0, .35), (1.0, .78), (.95, .83), (.60, .80), (0, .80)]),
    (-1.66, [(0, .15), (.88, .15), (1.0, .355), (1.0, .72), (.95, .82), (.58, .795), (0, .79)]),
    (-1.96, [(0, .19), (.86, .19), (.98, .36), (.98, .60), (.93, .79), (.55, .785), (0, .78)]),
    (-2.14, [(0, .25), (.80, .25), (.93, .38), (.94, .58), (.89, .76), (.52, .76), (0, .76)]),
]
shell = loft('Body shell', [mirrored(z, half) for z, half in BODY], paint, .018)
# Open wheel wells, lined in carbon: the cutter's faces keep its material.
# Each side is cut separately, so the bonnet and deck between the wheels stay whole.
for z, wheel in ((FRONT_AXLE, FRONT), (REAR_AXLE, REAR)):
    for s in (-1, 1):
        cutter = cylinder('Wheel arch tool', (s*(wheel['x'] + .3), wheel['radius'], z), wheel['radius'] + .035, .62 + wheel['width'] * .5, carbon, vertices=40, bevel=0)
        mod = shell.modifiers.new('Open wheel well', 'BOOLEAN'); mod.operation = 'DIFFERENCE'; mod.object = cutter
        mod.material_mode = 'TRANSFER'
        bpy.context.view_layer.objects.active = shell
        for previous in list(shell.modifiers):
            bpy.ops.object.modifier_apply(modifier=previous.name)
        bpy.data.objects.remove(cutter, do_unlink=True)

# ---- Greenhouse: a gold-glazed canopy from the windshield base to the B-pillar
# line, then a white fastback falling to the tail with a narrow rear window.
def canopy_ring(z, base, side, roof, crown):
    half = [(0, base[1] - .04), (base[0], base[1] - .04), base, side, roof, (0, crown)]
    return mirrored(z, half)
CANOPY = [
    (.84, (.83, .735), (.79, .745), (.66, .752), .757),
    (.64, (.855, .755), (.79, .82), (.59, .87), .885),
    (.42, (.87, .775), (.78, .885), (.52, .97), .99),
    (.2, (.877, .788), (.775, .935), (.50, 1.045), 1.065),
    (0, (.88, .80), (.77, .97), (.48, 1.075), 1.10),
    (-.42, (.88, .815), (.76, .975), (.46, 1.075), 1.095),
    (-.66, (.866, .82), (.74, .958), (.44, 1.048), 1.066),
    (-.90, (.85, .825), (.72, .935), (.42, 1.015), 1.03),
]
FASTBACK = [
    CANOPY[-1],
    (-1.42, (.93, .81), (.82, .87), (.45, .94), .955),
    (-1.98, (.93, .795), (.85, .815), (.46, .845), .853),
    (-2.12, (.90, .77), (.84, .78), (.45, .795), .80),
]
loft('Gold glazed canopy', [canopy_ring(*s) for s in CANOPY], glass, .008)
loft('Fastback deck', [canopy_ring(*s) for s in FASTBACK], paint, .015)
# A titanium spine along the crown of the canopy.
tube('Roof spine', [(0, .893, .64), (0, .997, .42), (0, 1.072, .2), (0, 1.107, 0), (0, 1.102, -.42), (0, 1.073, -.66), (0, 1.037, -.9)], .011, titanium)
# Narrow trapezoid rear window, set just proud of the fastback.
mesh('Rear window', [(-.33, 1.036, -.92), (.33, 1.036, -.92), (.24, .912, -1.70), (-.24, .912, -1.70)], [(0, 3, 2, 1)], glass)
for s in (-1, 1):
    # Titanium beltline trim and the slim A-pillars of the canopy.
    tube('Beltline trim', [(s*.835, .74, .84), (s*.858, .758, .64), (s*.875, .778, .42), (s*.882, .79, .2), (s*.885, .803, 0), (s*.885, .818, -.42), (s*.87, .823, -.66), (s*.855, .828, -.90)], .009, titanium)
    tube('B pillar', [(s*.86, .83, -.90), (s*.75, .95, -.90), (s*.51, 1.03, -.90)], .02, paint)
    # A titanium accent along the lower body crease, between the arches.
    box('Crease accent', (s*.985, .33, -.03), (.012, .014, 1.9), titanium, .004)
    # Butterfly door shut lines.
    tube('Door shut line', [(s*.99, .35, .70), (s*.995, .56, .66), (s*.92, .775, .62), (s*.93, .80, -.80), (s*1.0, .58, -.86), (s*.99, .35, -.84)], .005, carbon)

# ---- Lower aero in carbon: splitter, sill blades, side intakes and diffuser.
box('Front splitter', (0, .13, 2.06), (1.74, .035, .34), carbon, .008)
box('Front intake', (0, .265, 2.232), (1.2, .1, .02), carbon, .006)
for x in (-.45, -.15, .15, .45): box('Intake fin', (x, .265, 2.243), (.014, .09, .016), titanium, .002)
box('Intake lip', (0, .212, 2.24), (1.24, .012, .02), titanium, .003)
def bonnet_y(z):
    # Height of the bonnet's centre line between body stations, just above it.
    for (z0, h0), (z1, h1) in zip(BODY, BODY[1:]):
        if z1 <= z <= z0: return h1[-1][1] + (h0[-1][1] - h1[-1][1]) * (z - z1) / (z0 - z1) + .009
for s in (-1, 1):
    # Canards on the front corners and splitter end fences.
    for y, z, lean in ((.25, 2.06, .1), (.34, 1.98, .16)):
        box('Canard', (s*.95, y, z), (.07, .01, .16), carbon, .003, (0, s*.3, s*lean))
    box('Splitter fence', (s*.86, .175, 2.1), (.012, .07, .26), carbon, .003)
    # NACA ducts let air into the bonnet.
    x = s*.27
    mesh('Bonnet duct', [(x - .02, bonnet_y(1.74), 1.74), (x + .02, bonnet_y(1.74), 1.74), (x + .085, bonnet_y(1.2), 1.2), (x - .085, bonnet_y(1.2), 1.2)], [(0, 3, 2, 1)], carbon)
bpy.ops.mesh.primitive_torus_add(major_segments=16, minor_segments=4, major_radius=.045, minor_radius=.012, location=p((.62, .13, 2.17)))
o = bpy.context.object; o.rotation_euler = p((1, 0, 0)).to_track_quat('Z', 'Y').to_euler(); finish(o, 'Tow strap', strap)
for s in (-1, 1):
    box('Sill blade', (s*.94, .145, 0), (.13, .07, 1.92), carbon, .008)
    box('Side intake', (s*.993, .5, -.66), (.02, .06, .34), carbon, .006, (s*.12, 0, 0))
    box('Flank vent', (s*.994, .44, .82), (.014, .2, .34), carbon, .008)
    for z in (.7, .76): box('Flank vent slat', (s*1.0, .44, z), (.01, .17, .016), titanium, .002)
    for z in (-.7, -.8, -.9): box('Sill fin', (s*1.0, .18, z), (.03, .08, .012), carbon, .002)
    box('Rear haunch vent', (s*.86, .79, -1.62), (.16, .012, .32), carbon, .004)
box('Rear diffuser', (0, .30, -2.03), (1.78, .32, .26), carbon, .015)
for x in (-.66, -.33, 0, .33, .66):
    box('Diffuser strake', (x, .15, -2.0), (.018, .16, .5), carbon, .003)
# Louvres over the rear deck, between the haunches, behind the rear window.
for i in range(6):
    z = -1.76 - i * .055
    box('Deck louvre', (0, .955 + (z + 1.42) * .182 + .006, z), (.64, .012, .034), carbon, .003, (.3, 0, 0))
# Suction fans in the diffuser, between the strakes.
for x in (-.495, -.165, .165, .495):
    cylinder('Suction fan', (x, .225, -2.162), .072, .012, throat, (0, 0, 1), 20, 0)
    bpy.ops.mesh.primitive_torus_add(major_segments=20, minor_segments=4, major_radius=.075, minor_radius=.011, location=p((x, .225, -2.168)))
    finish(bpy.context.object, 'Fan ring', titanium)
    cylinder('Fan hub', (x, .225, -2.168), .022, .012, titanium, (0, 0, 1), 12, 0)
for s in (-1, 1):
    box('Reversing lens', (s*.78, .405, -2.164), (.12, .035, .01), lens, .004)
bpy.ops.mesh.primitive_torus_add(major_segments=16, minor_segments=4, major_radius=.045, minor_radius=.012, location=p((-.82, .18, -2.12)))
o = bpy.context.object; o.rotation_euler = p((1, 0, 0)).to_track_quat('Z', 'Y').to_euler(); finish(o, 'Tow strap', strap)

# ---- Lamps: hidden headlight slits at the front corners and the full-length taillight.
for s in (-1, 1):
    box('Headlight housing', (s*.65, .422, 2.198), (.40, .05, .03), carbon, .006, (0, s*.17, s*.1))
    box('Headlight slit', (s*.65, .425, 2.206), (.36, .02, .03), head, .004, (0, s*.17, s*.1))
box('Taillight band', (0, .675, -2.139), (1.76, .07, .012), carbon, .004)
box('Taillight bar', (0, .675, -2.146), (1.66, .026, .014), brake, .004)
box('Taillight trim', (0, .716, -2.142), (1.72, .008, .01), titanium, .002)
for s in (-1, 1):
    box('Taillight return', (s*.86, .665, -2.10), (.02, .03, .1), brake, .003, (0, s*.4, 0))
# A blank plate on the tail: no badges or lettering anywhere on the car.
box('Plate', (0, .555, -2.168), (.34, .1, .012), titanium, .006)

# ---- Rocket trim rear wing on swan-neck pylons.
WING_Y, WING_Z = 1.16, -1.93
mesh('Rear wing', [(-.98, WING_Y, WING_Z + .2), (.98, WING_Y, WING_Z + .2), (.98, WING_Y - .045, WING_Z - .2), (-.98, WING_Y - .045, WING_Z - .2),
    (-.98, WING_Y + .03, WING_Z + .05), (.98, WING_Y + .03, WING_Z + .05)],
    [(0, 1, 5, 4), (4, 5, 2, 3), (0, 3, 2, 1), (0, 4, 3), (1, 2, 5)], carbon, .006, True)
for s in (-1, 1):
    mesh('Wing endplate', [(s*.98, WING_Y - .12, WING_Z + .24), (s*.98, WING_Y + .08, WING_Z + .24), (s*.98, WING_Y + .12, WING_Z - .26), (s*.98, WING_Y - .10, WING_Z - .26),
        (s*1.0, WING_Y - .12, WING_Z + .24), (s*1.0, WING_Y + .08, WING_Z + .24), (s*1.0, WING_Y + .12, WING_Z - .26), (s*1.0, WING_Y - .10, WING_Z - .26)],
        [(0, 1, 2, 3), (4, 7, 6, 5), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)], carbon, .004)
    mesh('Wing pylon', [(s*.42, .80, -1.70), (s*.42, .80, -1.98), (s*.42, WING_Y, WING_Z + .02), (s*.42, WING_Y, WING_Z - .14),
        (s*.45, .80, -1.70), (s*.45, .80, -1.98), (s*.45, WING_Y, WING_Z + .02), (s*.45, WING_Y, WING_Z - .14)],
        [(0, 1, 3, 2), (4, 6, 7, 5), (0, 2, 6, 4), (1, 5, 7, 3), (2, 3, 7, 6), (0, 4, 5, 1)], carbon, .004)
box('Wing light', (0, WING_Y - .02, WING_Z - .205), (1.5, .014, .012), brake, .002)
box('Gurney flap', (0, WING_Y - .005, WING_Z - .195), (1.94, .03, .008), carbon, .002)
for s in (-1, 1):
    box('Wing mount', (s*.435, WING_Y + .028, WING_Z - .04), (.07, .012, .16), titanium, .003)
    box('Pylon foot', (s*.435, .803, -1.84), (.08, .014, .32), titanium, .003)
# The wing pivots on the pylon tops: braking, the game tilts it up as an air brake.
wing = empty('Rear_Wing', (0, WING_Y, WING_Z - .04), body)
bpy.context.view_layer.update()
for o in [o for o in body.children if o.name.startswith(('Rear wing', 'Wing endplate', 'Wing light', 'Gurney flap', 'Wing mount'))]:
    matrix = o.matrix_world.copy(); o.parent = wing; o.matrix_world = matrix

# ---- Cold-gas thrusters: titanium bells with sooty throats, ten in all.
def thruster(name, mouth, direction, scale=1):
    d = Vector(direction).normalized()
    bell = .13 * scale
    start = Vector(mouth) - d * bell
    cone(name + ' bell', tuple(start + d * bell / 2), .042 * scale, .07 * scale, bell, titanium, tuple(d))
    cone(name + ' throat', tuple(start + d * bell * .55), .03 * scale, .058 * scale, bell * .9, throat, tuple(d))
    cylinder(name + ' collar', tuple(start), .058 * scale, .04 * scale, carbon, tuple(d), 16, .004)
    e = empty('Exhaust_' + name.replace(' ', '_'), tuple(mouth), body)
    e['thrust'] = list(d); e['exitRadius'] = .07 * scale
    return e

for i, x in enumerate((-.6, -.2, .2, .6)):
    box('Heat shield', (x, .37, -2.164), (.2, .18, .01), titanium, .03)
    thruster(f'Rear {i+1}', (x, .37, -2.25), (0, 0, -1), 1.15)
for label, x, z in (('Lift FL', -.78, 1.92), ('Lift FR', .78, 1.92), ('Lift RL', -.80, -1.92), ('Lift RR', .80, -1.92)):
    box(label + ' pod', (x, .16, z), (.2, .07, .22), carbon, .01)
    thruster(label, (x, .085, z), (0, -1, 0), .9)
for label, s in (('Yaw L', -1), ('Yaw R', 1)):
    thruster(label, (s*1.005, .44, .92), (s, 0, 0), .75)

# ---- Wheels: slick low-profile tyres on thin six-spoke rims.
def wheel(prefix, spec, outward=1):
    R, rim, w = spec['radius'], spec['rim'], spec['width']
    profile = [(-w/2 + .012, rim + .005), (-w/2, rim + .03), (-w/2 + .004, R - .035), (-w/2 + .03, R), (w/2 - .03, R), (w/2 - .004, R - .035), (w/2, rim + .03), (w/2 - .012, rim + .005)]
    verts = []; n = 48
    for x, r in profile:
        for i in range(n):
            a = i*math.tau/n; verts.append((x, math.cos(a)*r, math.sin(a)*r))
    faces = []
    for j in range(len(profile)):
        for i in range(n):
            faces.append((j*n+i, j*n+(i+1)%n, ((j+1)%len(profile))*n+(i+1)%n, ((j+1)%len(profile))*n+i))
    mesh(prefix + ' tyre', verts, faces, rubber, 0, True)
    bpy.ops.mesh.primitive_torus_add(major_segments=48, minor_segments=4, major_radius=R - .055, minor_radius=.006, location=p((outward*w*.5, 0, 0)))
    o = bpy.context.object; o.rotation_euler = p((1, 0, 0)).to_track_quat('Z', 'Y').to_euler()
    finish(o, prefix + ' sidewall ridge', rubber)
    # An open barrel, closed behind the spokes, so the rim reads as spoked.
    cylinder(prefix + ' rim barrel', (0, 0, 0), rim, w * .9, graphite, vertices=32, caps=False)
    cylinder(prefix + ' back plate', (-outward*w*.3, 0, 0), rim, .01, graphite, vertices=32, bevel=0)
    bpy.ops.mesh.primitive_torus_add(major_segments=32, minor_segments=6, major_radius=rim - .01, minor_radius=.014, location=p((outward*w*.44, 0, 0)))
    o = bpy.context.object; o.rotation_euler = p((1, 0, 0)).to_track_quat('Z', 'Y').to_euler()
    finish(o, prefix + ' rim lip', titanium)
    cylinder(prefix + ' carbon ceramic disc', (outward*w*.12, 0, 0), rim * .78, .03, graphite, vertices=24)
    cylinder(prefix + ' centre', (outward*w*.4, 0, 0), .055, .06, graphite, vertices=16)
    # Three pairs of thin spokes, splayed toward the rim.
    for k in range(3):
        for split in (-.16, .16):
            a = k*math.tau/3
            beam(prefix + ' spoke', (outward*w*.42, math.cos(a)*.05, math.sin(a)*.05), (outward*w*.36, math.cos(a + split)*(rim - .012), math.sin(a + split)*(rim - .012)), .013, graphite, 6)
    cylinder(prefix + ' hub cap', (outward*w*.44, 0, 0), .028, .02, titanium, vertices=12)

wheel_groups = []
for side, label in [(-1, 'L'), (1, 'R')]:
    for z, end, spec in [(FRONT_AXLE, 'F', FRONT), (REAR_AXLE, 'R', REAR)]:
        pivot = empty('Wheel_' + end + label, (side*spec['x'], spec['radius'], z), root)
        spinner = empty('Spinner_' + end + label, parent=pivot)
        parent = spinner; wheel(end + label, spec, side); wheel_groups.append(spinner)
        # The caliper hangs on the pivot: it steers with the wheel but doesn't spin.
        parent = pivot
        a = .9 if end == 'F' else math.pi - .9
        box(end + label + ' caliper', (side*spec['width']*.12, math.sin(a)*spec['rim']*.68, math.cos(a)*spec['rim']*.68), (.06, .05, .15), caliper, .012, (-a + math.pi / 2, 0, 0))
parent = body

# Save the editable model before any export batching.
scene = bpy.context.scene
scene.unit_settings.system = 'METRIC'
scene.world.color = (.22, .22, .22)
scene.render.engine = 'CYCLES'; scene.cycles.samples = 32
scene.cycles.use_denoising = True
scene.render.resolution_x = 1500; scene.render.resolution_y = 1100; scene.render.resolution_percentage = 100
scene.view_settings.view_transform = 'AgX'
bpy.context.preferences.filepaths.save_version = 0
source_parts = len([o for o in root.children_recursive if o.type in {'MESH', 'CURVE', 'FONT'}])
# A studio scene remains in the blend, but is excluded from glTF export.
parent = None
floor = box('Studio floor', (0, -.05, 0), (200, .1, 200), mat('Studio', (.065, .088, .086), 0, .68), 0)
def area(name, loc, power, size, target=(0, .6, 0)):
    d = bpy.data.lights.new(name, 'AREA'); d.energy = power; d.shape = 'DISK'; d.size = size
    o = bpy.data.objects.new(name, d); scene.collection.objects.link(o); o.location = p(loc)
    o.rotation_euler = (p(target)-o.location).to_track_quat('-Z', 'Y').to_euler()
area('Large softbox', (-4, 6, 4), 1500, 5)
area('Cool fill', (4, 3, 2), 900, 4)
area('Tail rim', (1, 5, -5), 1600, 3)
camdata = bpy.data.cameras.new('Hero camera'); cam = bpy.data.objects.new('Hero camera', camdata)
# From the rear three-quarter, so the wing, taillight and rear thrusters show.
scene.collection.objects.link(cam); cam.location = p((-6.2, 3.1, -6.6))
cam.rotation_euler = (p((0, .3, -.2))-cam.location).to_track_quat('-Z', 'Y').to_euler()
camdata.type = 'ORTHO'; camdata.ortho_scale = 4.9; scene.camera = cam
bpy.ops.object.select_all(action='DESELECT'); root.select_set(True); bpy.context.view_layer.objects.active = root
for screen in bpy.data.screens:
    for area_ui in screen.areas:
        if area_ui.type == 'VIEW_3D':
            area_ui.spaces.active.region_3d.view_distance = 6
            area_ui.spaces.active.region_3d.view_location = p((0, .6, 0))
            area_ui.spaces.active.shading.type = 'MATERIAL'
bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'roadster-rocket.blend'))
scene.render.filepath = str(OUT/'roadster-preview.png')
bpy.ops.render.render(write_still=True)

# The same exporter can be run on a manually edited .blend without rebuilding it.
import sys
sys.path.insert(0, str(ROOT / 'scripts'))
from export_roadster import export_roadster
export_roadster(root, OUT, source_parts)

"""Render turnaround views of the generated character so it can be inspected.

    blender --background --python tools/preview.py -- <glb> <outdir>
"""
import bpy, sys, os, math

argv = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
GLB = argv[0]
OUT = argv[1]
os.makedirs(OUT, exist_ok=True)

bpy.ops.object.select_all(action='SELECT'); bpy.ops.object.delete()
bpy.ops.import_scene.gltf(filepath=GLB)

scn = bpy.context.scene
scn.render.engine = 'BLENDER_EEVEE'
scn.render.resolution_x = 520
scn.render.resolution_y = 900
scn.render.film_transparent = False
scn.world.use_nodes = True
scn.world.node_tree.nodes['Background'].inputs[0].default_value = (0.03, 0.03, 0.05, 1)

# three-point-ish rig so the silhouette and the surface both read
def lamp(name, loc, energy, size=3):
    d = bpy.data.lights.new(name, 'AREA'); d.energy = energy; d.size = size
    o = bpy.data.objects.new(name, d); o.location = loc
    bpy.context.collection.objects.link(o)
    return o
key = lamp('key', (2.4, -2.4, 3.0), 900)
key.rotation_euler = (math.radians(50), 0, math.radians(45))
rim = lamp('rim', (-2.2, 2.6, 2.2), 700)
rim.rotation_euler = (math.radians(60), 0, math.radians(210))
fill = lamp('fill', (-1.8, -2.2, 1.4), 220)
fill.rotation_euler = (math.radians(70), 0, math.radians(-40))

cam_data = bpy.data.cameras.new('cam'); cam_data.lens = 60
cam = bpy.data.objects.new('cam', cam_data)
bpy.context.collection.objects.link(cam); scn.camera = cam

# Aim with a Track To constraint rather than computing Euler angles by hand —
# far more reliable, and immune to whatever axis convention the import used.
bounds = [o for o in bpy.context.scene.objects if o.type == 'MESH']
if bounds:
    zs = [(o.matrix_world @ v.co).z for o in bounds for v in o.data.vertices]
    lo, hi = min(zs), max(zs)
else:
    lo, hi = 0.0, 1.8
mid = (lo + hi) / 2
height = max(hi - lo, 0.1)
print(f'MODEL BOUNDS z {lo:.3f}..{hi:.3f} (height {height:.3f})')

target = bpy.data.objects.new('target', None)
target.location = (0, 0, mid)
bpy.context.collection.objects.link(target)
con = cam.constraints.new('TRACK_TO')
con.target = target
con.track_axis = 'TRACK_NEGATIVE_Z'
con.up_axis = 'UP_Y'

r = height * 2.1
for name, ang in [('front', 0), ('threequarter', 35), ('side', 90)]:
    a = math.radians(ang)
    cam.location = (math.sin(a) * r, -math.cos(a) * r, mid + height * 0.12)
    bpy.context.view_layer.update()
    scn.render.filepath = os.path.join(OUT, f'{name}.png')
    bpy.ops.render.render(write_still=True)
print('PREVIEWS DONE')

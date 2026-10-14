"""
Generate the sorcerer as a real, skinned, rigged glTF character.

Run headless:
    blender --background --python tools/build_wizard.py

WHY THIS EXISTS
---------------
The in-game wizard was a stack of primitives — capsules for limbs, spheres for
joints — parented into a hierarchy. That approach has a hard ceiling: the parts
never merge into one surface, so at any real distance you see a mannequin
assembled from parts rather than a body.

This builds a single continuous mesh instead, then binds it to a skeleton, so
the surface *deforms* at the joints the way skin does.

METHOD
------
Blender's Skin modifier is the fastest route to a good organic base. You author
a stick figure as vertices and edges, give each vertex a radius, and the
modifier inflates a watertight quad mesh around it with clean topology and
proper limb intersections. Subdivision then smooths it. This is a standard
base-mesh workflow, and it is fully scriptable — no sculpting by hand.

The armature mirrors the same joint positions, so automatic weights bind
cleanly, and the bone names match what the renderer expects.
"""

import bpy
import bmesh
from mathutils import Vector
import os
import math

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'xr', 'public', 'wizard.glb')
OUT = os.path.normpath(OUT)


def clear_scene():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    for block in (bpy.data.meshes, bpy.data.armatures, bpy.data.materials, bpy.data.objects):
        for item in list(block):
            if item.users == 0:
                block.remove(item)


# ---------------------------------------------------------------------------
# Joint layout. One source of truth: the skin skeleton and the armature are
# both generated from this, so they cannot drift apart.
#
# Proportions are roughly 7.5 heads tall, measured in metres with the feet at
# the origin. Names match the bone names the web renderer drives.
#
# AXIS CONVENTION: Blender is Z-UP, so these are (x = left/right,
# y = forward/back, z = height). Authoring them Y-up builds the character lying
# on its back — which is exactly what happened the first time. The glTF
# exporter's export_yup then converts to the Y-up convention three.js expects.
# ---------------------------------------------------------------------------
J = {
    'root':        Vector((0.00, 0.00, 0.90)),
    'hips':        Vector((0.00, 0.00, 0.98)),
    'spine':       Vector((0.00, 0.010, 1.12)),
    'chest':       Vector((0.00, 0.015, 1.28)),
    'neck':        Vector((0.00, 0.005, 1.46)),
    'head':        Vector((0.00, 0.010, 1.57)),
    'skull':       Vector((0.00, 0.005, 1.66)),
    'headTop':     Vector((0.00, -0.01, 1.75)),

    'shoulder.L':  Vector((0.075, 0.00, 1.44)),
    'upperArm.L':  Vector((0.20, 0.00, 1.42)),
    'foreArm.L':   Vector((0.235, 0.02, 1.16)),
    'hand.L':      Vector((0.255, 0.03, 0.92)),
    'handEnd.L':   Vector((0.262, 0.03, 0.80)),

    'shoulder.R':  Vector((-0.075, 0.00, 1.44)),
    'upperArm.R':  Vector((-0.20, 0.00, 1.42)),
    'foreArm.R':   Vector((-0.235, 0.02, 1.16)),
    'hand.R':      Vector((-0.255, 0.03, 0.92)),
    'handEnd.R':   Vector((-0.262, 0.03, 0.80)),

    'thigh.L':     Vector((0.085, 0.00, 0.94)),
    'shin.L':      Vector((0.095, 0.005, 0.52)),
    'foot.L':      Vector((0.098, 0.00, 0.08)),
    'toe.L':       Vector((0.098, 0.13, 0.03)),

    'thigh.R':     Vector((-0.085, 0.00, 0.94)),
    'shin.R':      Vector((-0.095, 0.005, 0.52)),
    'foot.R':      Vector((-0.098, 0.00, 0.08)),
    'toe.R':       Vector((-0.098, 0.13, 0.03)),
}

# parent -> child, walked for both the skin mesh and the armature
BONES = [
    # Root. 'hips' is only ever a parent in the pairs below, and bones are named
    # after the child, so without this line no bone called 'hips' exists and the
    # pelvis cannot be posed at all.
    ('root', 'hips'),
    ('hips', 'spine'), ('spine', 'chest'), ('chest', 'neck'),
    ('neck', 'head'), ('head', 'skull'), ('skull', 'headTop'),

    ('chest', 'shoulder.L'), ('shoulder.L', 'upperArm.L'),
    ('upperArm.L', 'foreArm.L'), ('foreArm.L', 'hand.L'), ('hand.L', 'handEnd.L'),

    ('chest', 'shoulder.R'), ('shoulder.R', 'upperArm.R'),
    ('upperArm.R', 'foreArm.R'), ('foreArm.R', 'hand.R'), ('hand.R', 'handEnd.R'),

    ('hips', 'thigh.L'), ('thigh.L', 'shin.L'), ('shin.L', 'foot.L'), ('foot.L', 'toe.L'),
    ('hips', 'thigh.R'), ('thigh.R', 'shin.R'), ('shin.R', 'foot.R'), ('foot.R', 'toe.R'),
]

# Limb thickness at each joint. This is where the silhouette actually comes
# from: shoulders wide, waist tapered, wrists and ankles thin.
RADII = {
    # The silhouette lives here: broad chest, tapered waist, thin neck, and a
    # skull that is widest above the ears and narrows to the jaw and crown.
    'root': 0.120, 'hips': 0.128, 'spine': 0.108, 'chest': 0.152, 'neck': 0.052,
    'head': 0.082, 'skull': 0.098, 'headTop': 0.045,
    'shoulder.L': 0.088, 'upperArm.L': 0.058, 'foreArm.L': 0.044,
    'hand.L': 0.036, 'handEnd.L': 0.020,
    'shoulder.R': 0.088, 'upperArm.R': 0.058, 'foreArm.R': 0.044,
    'hand.R': 0.036, 'handEnd.R': 0.020,
    'thigh.L': 0.088, 'shin.L': 0.062, 'foot.L': 0.046, 'toe.L': 0.032,
    'thigh.R': 0.088, 'shin.R': 0.062, 'foot.R': 0.046, 'toe.R': 0.032,
}


def build_skin_mesh():
    """Stick figure -> Skin modifier -> subdivided organic body."""
    mesh = bpy.data.meshes.new('WizardBody')
    obj = bpy.data.objects.new('WizardBody', mesh)
    bpy.context.collection.objects.link(obj)

    bm = bmesh.new()
    verts = {}
    for name, co in J.items():
        verts[name] = bm.verts.new(co)
    bm.verts.ensure_lookup_table()
    for a, b in BONES:
        try:
            bm.edges.new((verts[a], verts[b]))
        except ValueError:
            pass  # edge already exists
    bm.to_mesh(mesh)
    bm.free()

    order = list(J.keys())

    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)

    skin = obj.modifiers.new('Skin', 'SKIN')
    skin.use_smooth_shade = True
    skin.branch_smoothing = 0.4   # softens the shoulder/hip junctions

    # Per-vertex radii live in the skin_vertices layer, indexed like mesh.vertices
    skin_data = obj.data.skin_vertices[0].data
    for i, name in enumerate(order):
        r = RADII[name]
        skin_data[i].radius = (r, r)
    # Root the skin at the hips so the generated topology flows outward from it
    skin_data[order.index('hips')].use_root = True

    sub = obj.modifiers.new('Subsurf', 'SUBSURF')
    sub.levels = 2
    sub.render_levels = 2

    bpy.ops.object.modifier_apply(modifier='Skin')
    bpy.ops.object.modifier_apply(modifier='Subsurf')

    # The Skin modifier produces a body of revolution around each bone, so the
    # head comes out as a rotationally symmetric capsule. Squash it front-to
    # -back and taper the jaw so it reads as a skull.
    shape_head(obj)
    sculpt_detail(obj, amount=0.0075, scale=16.0)

    # UV unwrap. Without UVs no texture, normal map or detail map can be
    # applied — which is the whole reason the character reads as a smooth
    # untextured shape. Smart Project is good enough for an organic body that
    # will carry procedural detail rather than hand-painted art.
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')

    # Shade smooth; the skin modifier leaves hard normals in places
    bpy.ops.object.shade_smooth()
    return obj


def sculpt_detail(obj, amount=0.008, scale=18.0, seed=3):
    """Displace vertices along their normals by layered noise.

    The Skin modifier produces a perfectly smooth tube, which is exactly why
    the body reads as a mannequin: real anatomy and real cloth are never
    smooth at this scale. This adds the low-amplitude, high-frequency surface
    variation the eye reads as substance — muscle, bone, the way fabric sits
    over a form.

    Deliberately subtle: pushed further it reads as damage rather than detail.
    """
    import mathutils
    noise = mathutils.noise
    mesh = obj.data
    mesh.calc_normals_split() if hasattr(mesh, 'calc_normals_split') else None
    for v in mesh.vertices:
        co = v.co
        p1 = mathutils.Vector((co.x * scale, co.y * scale, co.z * scale))
        p2 = p1 * 2.7
        n = noise.noise(p1) * 0.68 + noise.noise(p2) * 0.32
        v.co = co + v.normal * (n * amount)
    mesh.update()


def add_cloth_folds(obj, amount=0.012, scale=9.0):
    """Vertical fold structure for garments.

    Cloth does not wrinkle isotropically — it hangs, so folds run mostly
    VERTICALLY and deepen toward the hem where there is more material and less
    tension. Isotropic noise on a robe reads as crumpled paper.
    """
    import mathutils
    noise = mathutils.noise
    mesh = obj.data
    zs = [v.co.z for v in mesh.vertices]
    lo, hi = min(zs), max(zs)
    span = max(hi - lo, 1e-4)
    for v in mesh.vertices:
        # folds run around the garment, so sample mostly by ANGLE and height
        ang = math.atan2(v.co.y, v.co.x)
        drop = 1.0 - (v.co.z - lo) / span
        p = mathutils.Vector((ang * scale, v.co.z * scale * 0.5, 0.0))
        n = noise.noise(p) * 0.7 + noise.noise(p * 2.3) * 0.3
        v.co = v.co + v.normal * (n * amount * (0.25 + drop * 1.5))
    mesh.update()


def shape_head(obj):
    """Flatten and taper the head region of the finished mesh."""
    head_z = J['head'].z
    top_z = J['headTop'].z
    for v in obj.data.vertices:
        z = v.co.z
        if z < head_z - 0.09:
            continue
        # 0 at the base of the skull, 1 at the crown
        t = min(1.0, max(0.0, (z - (head_z - 0.09)) / (top_z - head_z + 0.09)))
        # heads are narrower than they are tall front-to-back: squash Y
        v.co.y *= 0.86
        # taper toward the crown so it is not a dome
        v.co.x *= 1.0 - 0.18 * t * t
        v.co.y *= 1.0 - 0.14 * t * t
        # push the lower front out slightly into a brow/jaw
        if v.co.y > 0 and t < 0.45:
            v.co.y += 0.012 * (1.0 - t / 0.45)


def build_armature():
    arm_data = bpy.data.armatures.new('WizardRig')
    arm = bpy.data.objects.new('WizardRig', arm_data)
    bpy.context.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')

    created = {}
    for parent, child in BONES:
        b = arm_data.edit_bones.new(child)
        b.head = J[parent]
        b.tail = J[child]
        created[child] = b

    # Re-parent in a second pass so a child's parent always exists first.
    for parent, child in BONES:
        if parent in created:
            created[child].parent = created[parent]
            # connect only where the joint is genuinely shared, so shoulders and
            # hips can splay without dragging the spine with them
            created[child].use_connect = created[parent].tail == created[child].head

    bpy.ops.object.mode_set(mode='OBJECT')
    return arm


def bind(mesh_obj, arm_obj):
    bpy.ops.object.select_all(action='DESELECT')
    mesh_obj.select_set(True)
    arm_obj.select_set(True)
    bpy.context.view_layer.objects.active = arm_obj
    # Heat-map weights: quality binding without hand-painting anything.
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')


def add_material(obj):
    mat = bpy.data.materials.new('WizardSkin')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (0.13, 0.09, 0.22, 1.0)
        if 'Roughness' in bsdf.inputs:
            bsdf.inputs['Roughness'].default_value = 0.78
        if 'Metallic' in bsdf.inputs:
            bsdf.inputs['Metallic'].default_value = 0.05
    obj.data.materials.append(mat)


def build_robe():
    """A skirted robe lofted around the legs, plus a shoulder mantle and hood.

    Modelled as separate meshes so they can carry their own materials, then
    bound to the same armature — so the cloth deforms with the body instead of
    being a rigid shell parented to a bone.
    """
    pieces = []

    # --- skirt: a lathe profile from the waist to the floor, with folds ---
    mesh = bpy.data.meshes.new('Robe')
    obj = bpy.data.objects.new('Robe', mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()

    SEG, RINGS = 48, 16
    profile = [
        (0.155, 1.06), (0.175, 0.98), (0.196, 0.88), (0.214, 0.76),
        (0.232, 0.62), (0.250, 0.48), (0.268, 0.34), (0.286, 0.22),
        (0.302, 0.12), (0.316, 0.05), (0.322, 0.01),
    ]
    rings = []
    for r, z in profile:
        ring = []
        for i in range(SEG):
            a = (i / SEG) * math.tau
            # vertical folds, deepest at the hem
            drop = 1.0 - (z - 0.01) / 1.05
            fold = math.sin(a * 9) * 0.012 * (drop ** 1.6)
            rr = r + fold
            ring.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, z)))
        rings.append(ring)
    bm.verts.ensure_lookup_table()
    for i in range(len(rings) - 1):
        for j in range(SEG):
            k = (j + 1) % SEG
            bm.faces.new((rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]))
    bm.to_mesh(mesh)
    bm.free()
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    # Catmull-Clark pulls the open ends of a tube inward, which ballooned the
    # waist into a dome. Creasing the boundary edges holds the silhouette.
    bmc = bmesh.new(); bmc.from_mesh(mesh)
    crease = bmc.edges.layers.float.get('crease_edge') or bmc.edges.layers.float.new('crease_edge')
    for e in bmc.edges:
        if e.is_boundary:
            e[crease] = 1.0
    bmc.to_mesh(mesh); bmc.free()
    sub = obj.modifiers.new('Subsurf', 'SUBSURF'); sub.levels = 1
    bpy.ops.object.modifier_apply(modifier='Subsurf')
    add_cloth_folds(obj, amount=0.014, scale=7.0)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.shade_smooth()
    pieces.append(obj)

    # --- hood: a hemisphere over the skull, open at the front -------------
    HOOD_C = Vector((0.0, 0.012, 1.605))
    bpy.ops.mesh.primitive_uv_sphere_add(radius=0.145, segments=30, ring_count=20,
                                         location=(0, 0, 0))
    hood = bpy.context.active_object
    hood.name = 'Hood'
    bmh = bmesh.new(); bmh.from_mesh(hood.data)
    # Sphere is authored at the origin, so these tests are in LOCAL space —
    # comparing against world Z on a sphere centred elsewhere cut the wrong
    # quadrant and left the cowl sitting at the neck like a collar.
    for v in list(bmh.verts):
        if v.co.y > 0.045 and v.co.z < 0.055:
            bmh.verts.remove(v)
    for v in bmh.verts:
        v.co.z *= 1.30                       # elongate into a cowl
        v.co.y *= 0.92                       # follow the flattened skull
        if v.co.z < -0.02:
            v.co.x *= 1.30; v.co.y *= 1.30   # flare over the shoulders
        v.co += HOOD_C
    bmh.to_mesh(hood.data); bmh.free()
    bpy.context.view_layer.objects.active = hood
    hood.select_set(True)
    add_cloth_folds(hood, amount=0.007, scale=11.0)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    bpy.ops.object.shade_smooth()
    pieces.append(hood)

    pieces.extend(build_armour())
    return pieces


def build_armour():
    """Hard-edged pieces worn over the cloth.

    A robed figure with no hard forms reads as a dressing gown. Pauldrons, a
    belt, a collar and cuffs break the silhouette and give the light something
    to catch — which is most of what separates a character from a shape at
    distance, where surface detail is invisible but the outline is not.
    """
    out = []

    def finish(obj, name):
        obj.name = name
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.shade_smooth()
        out.append(obj)

    # pauldrons: a squashed dome over each shoulder
    for side, x in (('L', 1), ('R', -1)):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=0.098, segments=22, ring_count=14,
                                             location=(0, 0, 0))
        o = bpy.context.active_object
        bm = bmesh.new(); bm.from_mesh(o.data)
        for v in list(bm.verts):
            if v.co.z < -0.005:
                bm.verts.remove(v)               # keep only the cap
        for v in bm.verts:
            v.co.z *= 0.58
            # Only a slight outward stretch: at 1.25 the domes projected well
            # past the shoulder line and read as handles rather than armour.
            v.co.x *= 1.05
            v.co += Vector((x * 0.150, 0.0, 1.405))
        bm.to_mesh(o.data); bm.free()
        finish(o, f'Pauldron.{side}')

    bpy.ops.mesh.primitive_torus_add(major_radius=0.172, minor_radius=0.026,
                                     major_segments=30, minor_segments=8,
                                     location=(0, 0, 1.06))
    finish(bpy.context.active_object, 'Belt')

    bpy.ops.mesh.primitive_torus_add(major_radius=0.098, minor_radius=0.024,
                                     major_segments=24, minor_segments=8,
                                     location=(0, 0.004, 1.44))
    finish(bpy.context.active_object, 'Collar')

    for side, x in (('L', 1), ('R', -1)):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.046, minor_radius=0.013,
                                         major_segments=16, minor_segments=6,
                                         location=(x * 0.250, 0.028, 0.99))
        finish(bpy.context.active_object, f'Cuff.{side}')

    return out


def add_metal_material(obj):
    mat = bpy.data.materials.new('WizardMetal')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (0.42, 0.33, 0.16, 1.0)
        if 'Roughness' in bsdf.inputs:
            bsdf.inputs['Roughness'].default_value = 0.34
        if 'Metallic' in bsdf.inputs:
            bsdf.inputs['Metallic'].default_value = 0.9
    obj.data.materials.append(mat)


def add_cloth_material(obj):
    mat = bpy.data.materials.new('WizardCloth')
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get('Principled BSDF')
    if bsdf:
        bsdf.inputs['Base Color'].default_value = (0.10, 0.06, 0.19, 1.0)
        if 'Roughness' in bsdf.inputs:
            bsdf.inputs['Roughness'].default_value = 0.92
    obj.data.materials.append(mat)


def main():
    clear_scene()
    body = build_skin_mesh()
    add_material(body)
    robe_pieces = build_robe()
    for pc in robe_pieces:
        # Material NAME is the contract with the renderer: it dresses each zone
        # differently (cloth weave vs scratched metal) based on this.
        if pc.name.startswith(('Pauldron', 'Belt', 'Collar', 'Cuff')):
            add_metal_material(pc)
        else:
            add_cloth_material(pc)
    rig = build_armature()
    bind(body, rig)
    for pc in robe_pieces:
        bind(pc, rig)

    bpy.ops.object.select_all(action='SELECT')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT,
        export_format='GLB',
        use_selection=True,
        export_apply=True,
        export_skins=True,
        export_yup=True,
    )
    verts = len(body.data.vertices)
    print(f'WROTE {OUT}  verts={verts}  bones={len(rig.data.bones)}')


main()

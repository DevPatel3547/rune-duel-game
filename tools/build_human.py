"""
Generate the sorcerer from a real anatomical human base mesh.

    blender --background --python tools/build_human.py

WHY THIS REPLACES tools/build_wizard.py
---------------------------------------
The previous character was built by inflating a stick figure with Blender's
Skin modifier. That produces a continuous, riggable body — a genuine step up
from stacked primitives — but it is still a tube approximating a person. It has
no anatomy: no clavicle, no ribcage, no deltoid, no brow, no cheekbone. Those
landmarks are what the eye actually uses to read "human", which is why it kept
coming back looking like a mannequin no matter how much surface detail was
added.

MPFB2 (the MakeHuman plugin for Blender) ships the MakeHuman base mesh: a real,
anatomically-modelled human topology with proper edge flow around the joints and
face. This script generates one, poses it, and exports it rigged.
"""

import bpy
import os
import sys

OUT = os.path.normpath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), '..', 'xr', 'public', 'wizard.glb'))


def log(*a):
    print('[build_human]', *a)


def clear():
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)


def enable_mpfb():
    try:
        bpy.ops.preferences.addon_enable(module='bl_ext.user_default.mpfb')
    except Exception as e:
        log('addon enable failed:', e)


def make_human():
    """Create the MakeHuman base mesh and give it a game-ready skeleton."""
    # create_human takes its settings from scene properties the UI would set;
    # the defaults give a neutral adult, which is what we want as a base.
    bpy.ops.mpfb.create_human()
    body = bpy.context.active_object
    log('base mesh:', body.name, len(body.data.vertices), 'verts')

    # The standard rig is a straightforward deform skeleton — far more suitable
    # for driving from code than Rigify's control hierarchy, which is built for
    # animators posing by hand.
    try:
        bpy.ops.mpfb.add_standard_rig()
        log('standard rig added')
    except Exception as e:
        log('standard rig failed:', e)

    return body


def build_costume(body, rig):
    """Robe, hood and armour over the anatomical base, bound to its skeleton.

    Built as separate meshes rather than by sculpting the body, so the human
    underneath stays a clean, correctly-weighted base — and so the costume can
    be changed without regenerating the character.
    """
    import bmesh
    from mathutils import Vector
    import math

    pieces = []

    def finish(obj, name, metal=False):
        obj.name = name
        bpy.context.view_layer.objects.active = obj
        obj.select_set(True)
        bpy.ops.object.shade_smooth()
        mat = bpy.data.materials.new('WizardMetal' if metal else 'WizardCloth')
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get('Principled BSDF')
        if bsdf:
            bsdf.inputs['Base Color'].default_value = (
                (0.44, 0.34, 0.16, 1.0) if metal else (0.10, 0.07, 0.15, 1.0))
            if 'Roughness' in bsdf.inputs:
                bsdf.inputs['Roughness'].default_value = 0.34 if metal else 0.92
            if 'Metallic' in bsdf.inputs:
                bsdf.inputs['Metallic'].default_value = 0.95 if metal else 0.0
        obj.data.materials.append(mat)
        pieces.append(obj)

    # Measure the actual body so the costume fits whatever MakeHuman produced,
    # rather than hard-coding numbers that silently drift if the base changes.
    zs = [v.co.z for v in body.data.vertices]
    lo, hi = min(zs), max(zs)
    height = hi - lo
    waist_z = lo + height * 0.55
    log(f'body height {height:.3f}  waist {waist_z:.3f}')

    # --- robe: lathe from the waist to the floor, with vertical folds -----
    mesh = bpy.data.meshes.new('Robe')
    obj = bpy.data.objects.new('Robe', mesh)
    bpy.context.collection.objects.link(obj)
    bm = bmesh.new()
    SEG = 56
    profile = [(0.17, 1.00), (0.20, 0.86), (0.225, 0.70), (0.25, 0.54),
               (0.275, 0.38), (0.30, 0.24), (0.32, 0.12), (0.335, 0.03)]
    rings = []
    for r, t in profile:
        z = lo + (waist_z - lo) * t
        ring = []
        for i in range(SEG):
            a = (i / SEG) * math.tau
            fold = math.sin(a * 11) * 0.010 * ((1 - t) ** 1.4)
            rr = r + fold
            ring.append(bm.verts.new((math.cos(a) * rr, math.sin(a) * rr, z)))
        rings.append(ring)
    bm.verts.ensure_lookup_table()
    for i in range(len(rings) - 1):
        for j in range(SEG):
            k = (j + 1) % SEG
            bm.faces.new((rings[i][j], rings[i][k], rings[i + 1][k], rings[i + 1][j]))
    bm.to_mesh(mesh); bm.free()
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    finish(obj, 'Robe')

    # --- upper robe: torso + shoulders, lofted from measured body widths ---
    # Sampling the body's actual silhouette per height band means the garment
    # fits whatever MakeHuman produced instead of floating off a guessed radius.
    def body_radius_at(z, band=0.02):
        # The base mesh stands in an A-pose, so a naive max() at chest height
        # measures the ARM SPAN and the garment balloons into a mushroom.
        # Restrict to the torso column, and take a high percentile rather than
        # the max so a single stray vertex cannot define the silhouette.
        torso_cut = height * 0.13
        rs = sorted(math.hypot(v.co.x, v.co.y * 0.85) for v in body.data.vertices
                    if abs(v.co.z - z) < band and abs(v.co.x) < torso_cut)
        if not rs:
            return height * 0.085
        return rs[int(len(rs) * 0.92)]

    mesh2 = bpy.data.meshes.new('RobeTop')
    top = bpy.data.objects.new('RobeTop', mesh2)
    bpy.context.collection.objects.link(top)
    bm3 = bmesh.new()
    neck_z = lo + height * 0.855
    bands, rings2 = 10, []
    for i in range(bands + 1):
        t = i / bands
        z = waist_z + (neck_z - waist_z) * t
        # widen over the chest and shoulders, pinch slightly at the neck
        r = body_radius_at(z) * (1.10 - 0.06 * t) + 0.014
        ring = []
        for j in range(SEG):
            a = (j / SEG) * math.tau
            fold = math.sin(a * 9) * 0.005
            ring.append(bm3.verts.new((math.cos(a) * (r + fold),
                                       math.sin(a) * (r + fold) * 0.82, z)))
        rings2.append(ring)
    bm3.verts.ensure_lookup_table()
    for i in range(len(rings2) - 1):
        for j in range(SEG):
            k = (j + 1) % SEG
            bm3.faces.new((rings2[i][j], rings2[i][k], rings2[i + 1][k], rings2[i + 1][j]))
    bm3.to_mesh(mesh2); bm3.free()
    bpy.context.view_layer.objects.active = top
    top.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    finish(top, 'RobeTop')

    # --- sleeves: tapered tubes down each arm ----------------------------
    for side, sx in (('L', 1), ('R', -1)):
        # follow the actual arm: shoulder -> elbow -> wrist from the rig
        sh = rig.data.bones.get(f'upperarm01.{side}')
        wr = rig.data.bones.get(f'wrist.{side}')
        if not sh or not wr:
            continue
        a0 = sh.head_local
        a1 = wr.head_local
        msleeve = bpy.data.meshes.new(f'Sleeve.{side}')
        sl = bpy.data.objects.new(f'Sleeve.{side}', msleeve)
        bpy.context.collection.objects.link(sl)
        bmS = bmesh.new()
        SEGS, STEPS = 16, 8
        ringsS = []
        axis = (a1 - a0)
        for i in range(STEPS + 1):
            t = i / STEPS
            c = a0.lerp(a1, t)
            r = (0.062 - 0.020 * t) + 0.010
            ring = []
            for j in range(SEGS):
                ang = (j / SEGS) * math.tau
                # ring perpendicular to the arm axis
                up = Vector((0, 0, 1))
                n = axis.normalized()
                u = n.cross(up).normalized() if abs(n.z) < 0.99 else Vector((1, 0, 0))
                v = n.cross(u)
                off = u * (math.cos(ang) * r) + v * (math.sin(ang) * r)
                ring.append(bmS.verts.new(c + off))
            ringsS.append(ring)
        bmS.verts.ensure_lookup_table()
        for i in range(len(ringsS) - 1):
            for j in range(SEGS):
                k = (j + 1) % SEGS
                bmS.faces.new((ringsS[i][j], ringsS[i][k], ringsS[i + 1][k], ringsS[i + 1][j]))
        bmS.to_mesh(msleeve); bmS.free()
        bpy.context.view_layer.objects.active = sl
        sl.select_set(True)
        bpy.ops.object.mode_set(mode='EDIT')
        bpy.ops.mesh.select_all(action='SELECT')
        bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
        bpy.ops.object.mode_set(mode='OBJECT')
        finish(sl, f'Sleeve.{side}')

    # --- hood over the skull ---------------------------------------------
    head_z = lo + height * 0.93
    bpy.ops.mesh.primitive_uv_sphere_add(radius=height * 0.075, segments=28, ring_count=18,
                                         location=(0, 0, 0))
    hood = bpy.context.active_object
    bmh = bmesh.new(); bmh.from_mesh(hood.data)
    # Cut a face opening at the FRONT and drop the cowl back, so it frames the
    # head rather than sealing over it like a swim cap.
    for v in list(bmh.verts):
        if v.co.y > height * 0.014 and v.co.z < height * 0.030:
            bmh.verts.remove(v)
    for v in bmh.verts:
        v.co.z *= 1.30
        if v.co.z < 0:
            v.co.x *= 1.35; v.co.y *= 1.35      # flare onto the shoulders
        v.co += Vector((0, -height * 0.008, head_z))
    bmh.to_mesh(hood.data); bmh.free()
    bpy.context.view_layer.objects.active = hood
    hood.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=1.15, island_margin=0.02)
    bpy.ops.object.mode_set(mode='OBJECT')
    finish(hood, 'Hood')

    # --- pauldrons, belt, collar -----------------------------------------
    sh_z = lo + height * 0.815
    for side, x in (('L', 1), ('R', -1)):
        bpy.ops.mesh.primitive_uv_sphere_add(radius=height * 0.058, segments=20, ring_count=12,
                                             location=(0, 0, 0))
        o = bpy.context.active_object
        bm2 = bmesh.new(); bm2.from_mesh(o.data)
        for v in list(bm2.verts):
            if v.co.z < 0:
                bm2.verts.remove(v)
        for v in bm2.verts:
            v.co.z *= 0.6
            v.co += Vector((x * height * 0.105, 0, sh_z))
        bm2.to_mesh(o.data); bm2.free()
        finish(o, f'Pauldron.{side}', metal=True)

    bpy.ops.mesh.primitive_torus_add(major_radius=height * 0.108, minor_radius=height * 0.015,
                                     major_segments=32, minor_segments=8,
                                     location=(0, 0, waist_z))
    finish(bpy.context.active_object, 'Belt', metal=True)

    # bind the costume to the same skeleton so it deforms with the body
    for pc in pieces:
        bpy.ops.object.select_all(action='DESELECT')
        pc.select_set(True)
        rig.select_set(True)
        bpy.context.view_layer.objects.active = rig
        bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    log('costume bound:', [p.name for p in pieces])
    return pieces


def main():
    clear()
    enable_mpfb()
    body = make_human()

    # Report what we ended up with so the caller can see whether the rig bound.
    rig = next((o for o in bpy.context.scene.objects if o.type == 'ARMATURE'), None)
    if rig:
        build_costume(body, rig)

    arms = [o for o in bpy.context.scene.objects if o.type == 'ARMATURE']
    meshes = [o for o in bpy.context.scene.objects if o.type == 'MESH']
    log('armatures:', [(a.name, len(a.data.bones)) for a in arms])
    log('meshes:', [(m.name, len(m.data.vertices)) for m in meshes])

    bpy.ops.object.select_all(action='SELECT')
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    bpy.ops.export_scene.gltf(
        filepath=OUT, export_format='GLB', use_selection=True,
        export_apply=True, export_skins=True, export_yup=True,
    )
    log('WROTE', OUT, os.path.getsize(OUT) // 1024, 'KB')


main()

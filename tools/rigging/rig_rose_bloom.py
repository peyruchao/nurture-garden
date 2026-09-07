#!/usr/bin/env python3
"""Add a radial petal rig, generated green sepals, and a bud-to-bloom
animation to a static rose GLB.

Same approach as rig_flower_bloom.py (radial "fishbone" chains around the
flower axis, geometry-driven weights blurred in 3D), plus:

* the model's own small leaves right under the head are detected (green
  clusters just below the petals) and each gets a joint, so in the bud they
  fold up and hug the closed petals like sepals;
* a two-stage "bloom" clip: the leaves peel open first, then the petals unfurl
  from a tight ball into the scanned open rose (the bind pose).

Expects an uncompressed float GLB (run `gltf-transform dequantize` first).
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np

from glb_io import (
    accessor_array,
    append_accessor,
    append_buffer_view,
    first_primitive,
    read_glb,
    write_glb,
)
from rig_flower_bloom import axis_angle_quat, sample_vertex_colors, smoothstep


def rodrigues(v, k, angle):
    k = np.asarray(k, float)
    k = k / np.linalg.norm(k)
    v = np.asarray(v, float)
    return v * math.cos(angle) + np.cross(k, v) * math.sin(angle) + k * np.dot(k, v) * (1 - math.cos(angle))


def cluster_cells(points, cell):
    """Connected components of occupied grid cells (26-neighbourhood)."""
    keys = np.floor(points / cell).astype(np.int64)
    unique, inverse = np.unique(keys, axis=0, return_inverse=True)
    inverse = inverse.reshape(-1)
    index = {tuple(k): i for i, k in enumerate(unique)}
    parent = np.arange(len(unique))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    offsets = [(i, j, k) for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1) if (i, j, k) != (0, 0, 0)]
    for i, k in enumerate(unique):
        for o in offsets:
            j = index.get((k[0] + o[0], k[1] + o[1], k[2] + o[2]))
            if j is not None:
                ra, rb = find(i), find(j)
                if ra != rb:
                    parent[max(ra, rb)] = min(ra, rb)
    roots = np.array([find(i) for i in range(len(unique))])
    return roots[inverse]


def add_rose_rig(source: Path, output: Path, *, sectors: int = 16, max_leaves: int = 4, duration: float = 6.0,
                 collar_lean: float = 16.0, collar_slide: float = 0.06):
    document, binary = read_glb(source)
    if document.get("skins") or document.get("animations"):
        raise ValueError(f"Source already contains a skin or animation: {source}")

    primitive = first_primitive(document)
    mesh_index = next(node["mesh"] for node in document["nodes"] if "mesh" in node)
    mesh_node_index = next(i for i, node in enumerate(document["nodes"]) if "mesh" in node)
    mesh_node = document["nodes"][mesh_node_index]

    positions = accessor_array(document, binary, primitive["attributes"]["POSITION"], writable=True)
    scale = np.asarray(mesh_node.pop("scale", [1, 1, 1]), dtype=np.float32)
    translation = np.asarray(mesh_node.pop("translation", [0, 0, 0]), dtype=np.float32)
    positions[:] = positions * scale + translation
    mesh_node.pop("rotation", None)
    pos_acc = document["accessors"][primitive["attributes"]["POSITION"]]
    pos_acc["min"] = positions.min(axis=0).astype(float).tolist()
    pos_acc["max"] = positions.max(axis=0).astype(float).tolist()
    positions = positions.astype(np.float32, copy=True)

    uv = accessor_array(document, binary, primitive["attributes"]["TEXCOORD_0"]).astype(np.float32)
    colors = sample_vertex_colors(document, binary, uv)
    r_, g_, b_ = colors[:, 0], colors[:, 1], colors[:, 2]
    green = (g_ > r_) & (g_ > b_)
    red = ~green

    y = positions[:, 1]
    radius = np.hypot(positions[:, 0], positions[:, 2])
    angle = np.arctan2(positions[:, 2], positions[:, 0])

    # Landmarks: the head is the red mass; its base is where red starts.
    head_base = float(np.percentile(y[red], 2))
    head_top = float(np.percentile(y[red], 99.5))
    head_r = float(np.percentile(radius[red], 97))
    head_h = head_top - head_base
    pivot_y = head_base + head_h * 0.08
    base_r = head_r * 0.22
    tip_y = head_base + head_h * 0.55
    tip_r = head_r * 0.62

    count = len(positions)

    # Small leaves right under the head: green clusters just below the petals
    # that stick out from the stem. They become the "sepals" of the bud.
    cand = np.flatnonzero(green & (y < head_base + 0.03) & (radius > 0.09))
    labels = cluster_cells(positions[cand], 0.02)
    leaves = []
    for label in np.unique(labels):
        rows = cand[labels == label]
        if len(rows) < 600:
            continue
        pts = positions[rows]
        rr = radius[rows]
        base = pts[rr <= np.percentile(rr, 8)].mean(axis=0)
        # Leaf axis: from the stalk to the far end (mean of the farthest 10%).
        dist = np.linalg.norm(pts - base, axis=1)
        tip = pts[dist >= np.percentile(dist, 90)].mean(axis=0)
        e = tip - base
        length = float(np.linalg.norm(e))
        e = e / max(length, 1e-6)
        big = float(pts[:, 1].max() - pts[:, 1].min()) > 0.12   # stem leaves vs. small collar leaves
        leaves.append({"rows": rows, "base": base, "tip": tip, "dir": e, "length": length, "big": big})
    leaves.sort(key=lambda leaf: -len(leaf["rows"]))
    small = [leaf for leaf in leaves if not leaf["big"]][:max_leaves]
    big_leaves = [leaf for leaf in leaves if leaf["big"]][:2]
    leaves = small + big_leaves

    # Include each leaf's stalk down to the stem surface and pivot there, so the
    # whole leaf swings as one piece instead of leaving an L-shaped stub behind.
    stem_r = float(np.percentile(radius[green & (y > head_base - 0.06) & (y < head_base) & (radius < 0.09)], 60))
    for leaf in leaves:
        base = leaf["base"]
        d = np.array([base[0], 0.0, base[2]])
        d /= max(np.linalg.norm(d), 1e-6)
        cos_gap = (positions[:, 0] * d[0] + positions[:, 2] * d[2]) / np.maximum(radius, 1e-6)
        stalk = green & (np.abs(y - base[1]) < (0.05 if leaf["big"] else 0.03)) & (cos_gap > 0.85) \
            & (radius > stem_r - 0.005) & (radius < np.hypot(base[0], base[2]) + 0.005)
        leaf["rows"] = np.unique(np.concatenate([leaf["rows"], np.flatnonzero(stalk)]))
        pivot = d * (stem_r + 0.002) + np.array([0.0, base[1], 0.0])
        leaf["base"] = pivot.astype(np.float32)
        e = leaf["tip"] - pivot
        leaf["length"] = float(np.linalg.norm(e))
        leaf["dir"] = (e / max(leaf["length"], 1e-6)).astype(np.float32)

    J_ROOT, J_STEM, J_HEAD, J_TWIST = 0, 1, 2, 3
    petal_base = lambda k: 4 + 2 * k
    petal_tip = lambda k: 5 + 2 * k
    leaf_joint = lambda s: 4 + 2 * sectors + 2 * s          # base joint at the stalk
    leaf_mid = lambda s: 5 + 2 * sectors + 2 * s            # mid joint ~50% along the blade
    joint_count = 4 + 2 * sectors + 2 * len(leaves)

    # Fields: stem vs head, and how much a head vertex belongs to a folding petal.
    headness = smoothstep((y - (head_base - 0.06)) / 0.10)
    headness = np.where(green & (y < head_base + 0.05), 0.0, headness)
    headness = np.where(red, np.maximum(headness, smoothstep((y - (head_base - 0.1)) / 0.08)), headness)
    petalness = smoothstep((radius - head_r * 0.18) / (head_r * 0.30))     # inner core stays with head
    petalness *= headness

    sector_width = math.tau / sectors
    a = angle / sector_width
    k0 = np.floor(a).astype(int)
    frac = a - k0
    k0 %= sectors
    k1 = (k0 + 1) % sectors
    own = np.where(frac < 0.5, k0, k1)
    other = np.where(frac < 0.5, (k0 - 1) % sectors, k0)
    dist = np.abs(frac - 0.5)
    w_other = smoothstep((dist - 0.15) / 0.35) * 0.5
    w_own = 1.0 - w_other
    # Radial/height blend base -> tip: outer, upper petal parts follow the tip joint.
    radial = smoothstep((radius - head_r * 0.35) / (head_r * 0.45)) * 0.6 + smoothstep((y - tip_y) / (head_h * 0.4)) * 0.4

    dense = np.zeros((count, joint_count), dtype=np.float32)
    dense[:, J_STEM] = 1.0 - headness
    dense[:, J_HEAD] = headness * (1.0 - petalness)
    rows = np.arange(count)
    np.add.at(dense, (rows, 4 + 2 * own), petalness * w_own * (1 - radial))
    np.add.at(dense, (rows, 5 + 2 * own), petalness * w_own * radial)
    np.add.at(dense, (rows, 4 + 2 * other), petalness * w_other * (1 - radial))
    np.add.at(dense, (rows, 5 + 2 * other), petalness * w_other * radial)

    # Leaves follow their own joint, blending back into the stem at the stalk.
    for s_index, leaf in enumerate(leaves):
        lr = leaf["rows"]
        along = (positions[lr] - leaf["base"]) @ leaf["dir"]
        w = smoothstep(along / 0.014)
        w_mid = smoothstep((along / leaf["length"] - 0.35) / 0.4)
        dense[lr, :] = 0.0
        dense[lr, leaf_joint(s_index)] = w * (1.0 - w_mid)
        dense[lr, leaf_mid(s_index)] = w * w_mid
        dense[lr, J_STEM] = 1.0 - w

    cell = 0.02
    for shift in ((0, 0, 0), (0.5, 0.5, 0.5), (0.25, 0.75, 0.5), (0.75, 0.25, 0.0)):
        keys = np.floor(positions / cell + np.asarray(shift, dtype=np.float32)).astype(np.int64)
        _, inverse = np.unique(keys, axis=0, return_inverse=True)
        inverse = inverse.reshape(-1)
        sums = np.zeros((inverse.max() + 1, joint_count), dtype=np.float32)
        np.add.at(sums, inverse, dense)
        counts = np.bincount(inverse).astype(np.float32)[:, None]
        dense = 0.5 * dense + 0.5 * (sums / counts)[inverse]

    top = np.argsort(-dense, axis=1)[:, :4]
    weights = np.take_along_axis(dense, top, axis=1).astype(np.float32)
    weights /= np.maximum(weights.sum(axis=1, keepdims=True), 1e-6)
    joints = top.astype(np.uint8)
    joints[weights <= 1e-4] = 0
    weights[weights <= 1e-4] = 0
    weights /= np.maximum(weights.sum(axis=1, keepdims=True), 1e-6)

    joints_view = append_buffer_view(document, binary, joints.tobytes(), target=34962)
    weights_view = append_buffer_view(document, binary, weights.astype("<f4").tobytes(), target=34962)
    primitive["attributes"]["JOINTS_0"] = append_accessor(
        document, joints_view, component_type=5121, count=count, accessor_type="VEC4")
    primitive["attributes"]["WEIGHTS_0"] = append_accessor(
        document, weights_view, component_type=5126, count=count, accessor_type="VEC4")

    # ---- joints -----------------------------------------------------------
    node_offset = len(document["nodes"])
    n = lambda j: node_offset + j
    world = np.zeros((joint_count, 3))
    head_world = np.array([0.0, pivot_y, 0.0])
    world[J_HEAD] = head_world
    world[J_TWIST] = head_world
    nodes = [
        {"name": "Rose_Root", "children": [n(J_STEM)]},
        {"name": "Rose_Stem", "children": [n(J_HEAD)]},
        {"name": "Rose_Head", "translation": head_world.tolist(), "children": [n(J_TWIST)]},
        # Extra spin for the outer petal layer so the rose unfurls in a spiral.
        {"name": "Rose_Twist", "children": []},
    ]
    sector_dirs = []
    for k in range(sectors):
        phi = (k + 0.5) * sector_width
        d = np.array([math.cos(phi), 0.0, math.sin(phi)])
        sector_dirs.append(d)
        base_world = d * base_r + np.array([0.0, pivot_y, 0.0])
        tip_world = d * tip_r + np.array([0.0, tip_y, 0.0])
        world[petal_base(k)] = base_world
        world[petal_tip(k)] = tip_world
        nodes.append({"name": f"Petal{k:02d}_Base", "translation": (base_world - head_world).tolist(),
                      "children": [n(petal_tip(k))]})
        nodes.append({"name": f"Petal{k:02d}_Tip", "translation": (tip_world - base_world).tolist()})
        nodes[J_TWIST]["children"].append(n(petal_base(k)))

    # ---- leaf joints --------------------------------------------------------
    leaf_rotations = []
    for s_index, leaf in enumerate(leaves):
        pivot = leaf["base"].astype(np.float64)
        e = leaf["dir"].astype(np.float64)
        mid = pivot + e * leaf["length"] * 0.5
        world[leaf_joint(s_index)] = pivot
        world[leaf_mid(s_index)] = mid
        prefix = 'StemLeaf' if leaf['big'] else 'Leaf'
        nodes.append({"name": f"{prefix}{s_index:02d}", "translation": pivot.tolist(), "children": [n(leaf_mid(s_index))]})
        nodes.append({"name": f"{prefix}{s_index:02d}_Mid", "translation": (mid - pivot).tolist()})
        nodes[J_STEM]["children"].append(n(leaf_joint(s_index)))
        horiz = np.array([pivot[0], 0.0, pivot[2]])
        d = horiz / max(np.linalg.norm(horiz), 1e-6)
        if leaf["big"]:
            # Fold up against the stem; opens outward from its base while blooming.
            target = np.array([0.10 * d[0], 0.99, 0.10 * d[2]])
        else:
            # Stand up around the bud but lean outward so the leaf stays outside the petals.
            lean = math.radians(collar_lean)
            target = np.array([math.sin(lean) * d[0], math.cos(lean), math.sin(lean) * d[2]])
        target /= np.linalg.norm(target)
        axis = np.cross(e, target)
        if np.linalg.norm(axis) < 1e-6:
            axis = np.array([-d[2], 0.0, d[0]])
        angle = math.acos(float(np.clip(np.dot(e, target), -1, 1)))
        leaf_rotations.append((axis / np.linalg.norm(axis), angle, d, leaf["big"]))
        print(f"  leaf {s_index} {'stem' if leaf['big'] else 'collar'}: base={np.round(pivot, 3)} dir={np.round(e, 2)} "
              f"-> bud dir={np.round(target, 2)} rotate {math.degrees(angle):.0f} deg")

    document["nodes"].extend(nodes)
    inverse_bind = np.repeat(np.eye(4, dtype="<f4")[None], joint_count, axis=0)
    inverse_bind[:, 3, :3] = -world.astype("<f4")
    ibm_view = append_buffer_view(document, binary, inverse_bind.tobytes())
    ibm_acc = append_accessor(document, ibm_view, component_type=5126, count=joint_count, accessor_type="MAT4")
    document["skins"] = [{"name": "Rose_BloomRig", "inverseBindMatrices": ibm_acc, "skeleton": n(J_ROOT),
                          "joints": [n(j) for j in range(joint_count)]}]
    mesh_node["skin"] = 0
    document["scenes"][document.get("scene", 0)].setdefault("nodes", []).append(n(J_ROOT))

    # ---- animation --------------------------------------------------------
    rng = np.random.default_rng(3)
    sample_count = int(duration * 30) + 1
    times = np.linspace(0, duration, sample_count, dtype="<f4")
    time_view = append_buffer_view(document, binary, times.tobytes())
    time_acc = append_accessor(document, time_view, component_type=5126, count=sample_count, accessor_type="SCALAR",
                               minimum=[0], maximum=[duration])
    samplers, channels = [], []

    def add_channel(node, path, values):
        view = append_buffer_view(document, binary, np.ascontiguousarray(values, dtype="<f4").tobytes())
        acc = append_accessor(document, view, component_type=5126, count=sample_count,
                              accessor_type="VEC4" if path == "rotation" else "VEC3")
        samplers.append({"input": time_acc, "output": acc, "interpolation": "LINEAR"})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": path}})

    t = times.astype(np.float64)
    # Collar leaves move in step with the outermost petals: the petal tip joints
    # start 0.4s ahead of the petal bases (0.9s) and use the same easing.
    petal_prog = lambda off: smoothstep((t - 1.3 - off) / 3.4)          # petals: 1.3s -> ~4.7s
    sepal_prog = lambda off: petal_prog(max(0.0, off - 0.4))

    closed = 1.0 - petal_prog(0.0)
    head_scale = 1.0 - 0.10 * closed          # loose bud, not a tight ball
    add_channel(n(J_HEAD), "scale", np.stack([head_scale] * 3, axis=1))
    # Spiral unfurl: the bud is pre-wound clockwise (seen from above), so the
    # petals spin counter-clockwise as they open. The inner core (head) turns
    # less than the outer petal layer (twist joint), like a real rose.
    up = np.array([0.0, 1.0, 0.0])
    add_channel(n(J_HEAD), "rotation", axis_angle_quat(up, -np.radians(30.0) * closed))
    closed_outer = 1.0 - petal_prog(0.0)
    add_channel(n(J_TWIST), "rotation", axis_angle_quat(up, -np.radians(45.0) * (1.0 - petal_prog(-0.3))))

    for k, d in enumerate(sector_dirs):
        off = float(rng.uniform(0.0, 0.3))
        c = 1.0 - petal_prog(off)
        c_tip = 1.0 - petal_prog(max(0.0, off - 0.4))               # outer/upper parts unfurl first
        lift_axis = np.array([-d[2], 0.0, d[0]])
        # Bud: lean petals toward the axis. Fully open: swing a little past the
        # scanned pose so the rose ends up more open than the source model.
        base_angle = np.radians(21.0 + rng.uniform(-2, 2)) * c - np.radians(10.0) * (1.0 - c)
        tip_angle = np.radians(14.0 + rng.uniform(-3, 3)) * c_tip - np.radians(7.0) * (1.0 - c_tip)
        add_channel(n(petal_base(k)), "rotation", axis_angle_quat(lift_axis, base_angle))
        add_channel(n(petal_tip(k)), "rotation", axis_angle_quat(lift_axis, tip_angle))
        rest = np.asarray(nodes[petal_base(k)]["translation"])
        inward = (-d * base_r * 0.25)[None, :] * c[:, None]
        add_channel(n(petal_base(k)), "translation", rest[None, :] + inward)

    stem_leaf_prog = lambda off: smoothstep((t - 1.0 - off) / 2.7)     # stem leaves: 1.0s -> ~3.7s
    for s_index, (axis, angle, d, big) in enumerate(leaf_rotations):
        rest = np.asarray(nodes[leaf_joint(s_index)]["translation"])
        off = float(rng.uniform(0.0, 0.2))
        if big:
            c = 1.0 - stem_leaf_prog(off)
            c_mid = 1.0 - stem_leaf_prog(off + 0.3)
            leaf_scale = 1.0 - 0.10 * c
        else:
            c = 1.0 - sepal_prog(off)
            c_mid = 1.0 - sepal_prog(off + 0.2)
            leaf_scale = 1.0 + 0.05 * c
            # Slide the base slightly outward so the collar sits on the petals.
            add_channel(n(leaf_joint(s_index)), "translation", rest[None, :] + (d * collar_slide)[None, :] * c[:, None])
        # Straight in the bud and at rest; while opening the blade tip lags the
        # base, so the leaf bends in a smooth arc instead of hinging like an L.
        add_channel(n(leaf_joint(s_index)), "rotation", axis_angle_quat(axis, angle * c))
        add_channel(n(leaf_mid(s_index)), "rotation", axis_angle_quat(axis, angle * 0.25 * (c_mid - c)))
        add_channel(n(leaf_joint(s_index)), "scale", np.stack([leaf_scale] * 3, axis=1))

    document["animations"] = [{"name": "bloom", "samplers": samplers, "channels": channels}]
    document.setdefault("asset", {})["generator"] = "Neocean rose bloom rig (radial fishbone + leaf sepals)"
    write_glb(output, document, binary)

    print(f"Source: {source.name}; vertices {count:,}; collar leaves {len(small)}, stem leaves {len(big_leaves)} "
          f"({[len(leaf['rows']) for leaf in leaves]} vertices)")
    print(f"Head: base y={head_base:.3f} top y={head_top:.3f} r={head_r:.3f}; petal pivots r={base_r:.3f} y={pivot_y:.3f}")
    print(f"Joints: {joint_count} ({sectors} petal sectors x 2, {len(leaves)} leaves x 2); animation 'bloom' {duration:.1f}s")
    print(f"Output: {output} ({output.stat().st_size / 1024 / 1024:.1f} MiB)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--sectors", type=int, default=16)
    parser.add_argument("--max-leaves", type=int, default=4)
    parser.add_argument("--duration", type=float, default=6.0)
    parser.add_argument("--collar-lean", type=float, default=16.0, help="collar leaf lean from vertical in the bud (deg)")
    parser.add_argument("--collar-slide", type=float, default=0.06, help="outward slide of collar leaf bases in the bud")
    args = parser.parse_args()
    add_rose_rig(args.source, args.output, sectors=args.sectors, max_leaves=args.max_leaves, duration=args.duration,
                 collar_lean=args.collar_lean, collar_slide=args.collar_slide)


if __name__ == "__main__":
    main()

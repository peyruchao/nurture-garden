#!/usr/bin/env python3
"""Add a radial "fishbone" petal rig and a bud-to-bloom animation to a static flower GLB.

Built on the shared numpy GLB helpers in glb_io.py (originally the neocean fish-tail rig). Instead of one tail
chain, the flower gets one two-joint chain per petal sector arranged radially
around the disc, plus a stem, head and disc joint:

    Root -> Stem -> Head -> Disc
                         -> PetalBase_k -> PetalTip_k   (k = 0..sectors-1)

Vertices are classified by sampling the base colour texture (white = petal,
orange = disc, green = stem). The bind pose is the scanned open flower; the
"bloom" animation starts from a closed bud (petals lifted and curled inward,
disc shrunk) and eases into the bind pose.

Expects an uncompressed float GLB (run `gltf-transform dequantize` first).
"""

from __future__ import annotations

import argparse
import io
import math
from pathlib import Path

import numpy as np
from PIL import Image

from glb_io import (
    accessor_array,
    append_accessor,
    append_buffer_view,
    first_primitive,
    read_glb,
    write_glb,
)


def smoothstep(x):
    x = np.clip(x, 0.0, 1.0)
    return x * x * (3.0 - 2.0 * x)


def axis_angle_quat(axis, angle):
    axis = np.asarray(axis, dtype=np.float64)
    axis = axis / max(np.linalg.norm(axis), 1e-9)
    s = np.sin(angle / 2.0)
    return np.concatenate([axis[None, :] * s[:, None], np.cos(angle / 2.0)[:, None]], axis=1).astype("<f4")


def sample_vertex_colors(document, binary, uv):
    image = document["images"][0]
    view = document["bufferViews"][image["bufferView"]]
    start = view.get("byteOffset", 0)
    data = bytes(binary[start:start + view["byteLength"]])
    texture = np.asarray(Image.open(io.BytesIO(data)).convert("RGB")).astype(np.float32) / 255.0
    height, width, _ = texture.shape
    u = np.clip((uv[:, 0] % 1.0) * (width - 1), 0, width - 1).astype(int)
    v = np.clip((uv[:, 1] % 1.0) * (height - 1), 0, height - 1).astype(int)
    return texture[v, u]


def classify(colors):
    r, g, b = colors[:, 0], colors[:, 1], colors[:, 2]
    mx = colors.max(axis=1)
    mn = colors.min(axis=1)
    sat = (mx - mn) / np.maximum(mx, 1e-3)
    white = (mn > 0.55) & (sat < 0.35)
    green = (g >= r) & (g > b) & (sat > 0.2) & ~white
    orange = ~white & ~green
    return white, orange, green


def add_bloom_rig(source: Path, output: Path, *, sectors: int = 18, duration: float = 6.0,
                  bud_hold: float = 0.6, open_time: float = 3.6, seed: int = 7):
    document, binary = read_glb(source)
    if document.get("skins") or document.get("animations"):
        raise ValueError(f"Source already contains a skin or animation: {source}")

    primitive = first_primitive(document)
    mesh_node_index = next(i for i, node in enumerate(document["nodes"]) if "mesh" in node)
    mesh_node = document["nodes"][mesh_node_index]

    positions = accessor_array(document, binary, primitive["attributes"]["POSITION"], writable=True)
    # Bake the mesh node transform: skinned vertices ignore the node transform.
    scale = np.asarray(mesh_node.pop("scale", [1, 1, 1]), dtype=np.float32)
    translation = np.asarray(mesh_node.pop("translation", [0, 0, 0]), dtype=np.float32)
    positions[:] = positions * scale + translation
    mesh_node.pop("rotation", None)
    position_accessor = document["accessors"][primitive["attributes"]["POSITION"]]
    position_accessor["min"] = positions.min(axis=0).astype(float).tolist()
    position_accessor["max"] = positions.max(axis=0).astype(float).tolist()
    positions = positions.astype(np.float32, copy=True)

    uv = accessor_array(document, binary, primitive["attributes"]["TEXCOORD_0"]).astype(np.float32)
    white, orange, green = classify(sample_vertex_colors(document, binary, uv))

    y = positions[:, 1]
    radius = np.hypot(positions[:, 0], positions[:, 2])
    angle = np.arctan2(positions[:, 2], positions[:, 0])

    # Geometry landmarks (Y up, flower head on +Y).
    # Pale vertices hidden under the disc near the axis, or on the disc's upper
    # rim, move with the disc; only the outer skirt of ray petals is rigged.
    disc_top = float(np.percentile(y[orange], 92))
    ray = white & (y > 0.05) & (radius > 0.35) & (y < disc_top - 0.05)   # colour-based ray petals
    petal_r0 = float(np.percentile(radius[ray], 4))            # petal attachment ring
    petal_r1 = float(np.percentile(radius[ray], 96))           # petal tip ring
    petal_y0 = float(np.median(y[ray & (radius > petal_r0) & (radius < petal_r0 + 0.15)]))
    head_y = float(np.percentile(y[orange & (y > 0.05)], 3))   # where the head meets the stem
    tip_r = petal_r0 + (petal_r1 - petal_r0) * 0.5

    count = len(positions)
    joint_count = 4 + 2 * sectors
    J_ROOT, J_STEM, J_HEAD, J_DISC = 0, 1, 2, 3
    petal_base = lambda k: 4 + 2 * k
    petal_tip = lambda k: 5 + 2 * k

    # Continuous fields instead of hard per-vertex classes. The scan is a soup
    # of small fragments, so any triangle whose corners disagree about which
    # bone they follow turns into a spike once the bud closes. Geometry-driven
    # fields refined by colour, then blurred in 3D, keep neighbours consistent.
    # Stem -> head. Only the thin stalk near the axis is stem; drooping petal
    # tips sit low but far from the axis and must follow the head.
    headness = np.maximum(smoothstep((y - 0.12) / 0.30), smoothstep((radius - 0.16) / 0.10))
    petalness = smoothstep((radius - (petal_r0 - 0.04)) / 0.14)
    petalness *= 1.0 - smoothstep((y - (disc_top - 0.10)) / 0.10)  # disc rim stays disc
    petalness = np.where(orange & (radius < petal_r0 + 0.16), petalness * 0.35, petalness)
    petalness = np.where(white & (radius > petal_r0 - 0.02), np.maximum(petalness, 0.7), petalness)
    petalness = np.clip(petalness * headness, 0.0, 1.0)

    sector_width = math.tau / sectors
    a = angle / sector_width
    k0 = np.floor(a).astype(int)
    frac = a - k0
    k0 %= sectors
    k1 = (k0 + 1) % sectors
    # Sector centre sits at frac=0.5; the neighbour sector fades in toward the boundary.
    own = np.where(frac < 0.5, k0, k1)
    other = np.where(frac < 0.5, (k0 - 1) % sectors, k0)
    dist = np.abs(frac - 0.5)
    w_other = smoothstep((dist - 0.2) / 0.3) * 0.5
    w_own = 1.0 - w_other
    radial = smoothstep((radius - (petal_r0 + 0.04)) / max(petal_r1 - petal_r0 - 0.12, 1e-3))

    dense = np.zeros((count, joint_count), dtype=np.float32)
    dense[:, J_STEM] = 1.0 - headness
    dense[:, J_DISC] = headness * (1.0 - petalness)
    rows = np.arange(count)
    np.add.at(dense, (rows, 4 + 2 * own), petalness * w_own * (1 - radial))
    np.add.at(dense, (rows, 5 + 2 * own), petalness * w_own * radial)
    np.add.at(dense, (rows, 4 + 2 * other), petalness * w_other * (1 - radial))
    np.add.at(dense, (rows, 5 + 2 * other), petalness * w_other * radial)

    # Spatial blur: average with everything in the same grid cell, over a few
    # shifted grids, so fragments that touch but share no vertices agree.
    cell = 0.035
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
    petal = petalness > 0.5
    disc = (petalness <= 0.5) & (headness > 0.5)
    stem_mask = headness <= 0.5

    joints_view = append_buffer_view(document, binary, joints.tobytes(), target=34962)
    weights_view = append_buffer_view(document, binary, weights.astype("<f4").tobytes(), target=34962)
    primitive["attributes"]["JOINTS_0"] = append_accessor(
        document, joints_view, component_type=5121, count=count, accessor_type="VEC4")
    primitive["attributes"]["WEIGHTS_0"] = append_accessor(
        document, weights_view, component_type=5126, count=count, accessor_type="VEC4")

    # Joint nodes. Bind pose has no rotations, so local axes equal world axes.
    node_offset = len(document["nodes"])
    n = lambda j: node_offset + j
    world = np.zeros((joint_count, 3), dtype=np.float64)
    nodes = [
        {"name": "Flower_Root", "children": [n(J_STEM)]},
        {"name": "Flower_Stem", "children": [n(J_HEAD)]},
        {"name": "Flower_Head", "translation": [0.0, head_y, 0.0], "children": [n(J_DISC)]},
        {"name": "Flower_Disc"},
    ]
    world[J_HEAD] = (0, head_y, 0)
    world[J_DISC] = (0, head_y, 0)
    sector_dirs = []
    for k in range(sectors):
        phi = (k + 0.5) * sector_width
        d = np.array([math.cos(phi), 0.0, math.sin(phi)])
        sector_dirs.append(d)
        base_world = d * petal_r0 + np.array([0.0, petal_y0, 0.0])
        tip_world = d * tip_r + np.array([0.0, petal_y0, 0.0])
        world[petal_base(k)] = base_world
        world[petal_tip(k)] = tip_world
        nodes.append({
            "name": f"Petal{k:02d}_Base",
            "translation": (base_world - world[J_HEAD]).tolist(),
            "children": [n(petal_tip(k))],
        })
        nodes.append({
            "name": f"Petal{k:02d}_Tip",
            "translation": (tip_world - base_world).tolist(),
        })
        nodes[J_HEAD]["children"].append(n(petal_base(k)))
    document["nodes"].extend(nodes)

    inverse_bind = np.repeat(np.eye(4, dtype="<f4")[None], joint_count, axis=0)
    inverse_bind[:, 3, :3] = -world.astype("<f4")   # column-major: row 3 holds translation
    ibm_view = append_buffer_view(document, binary, inverse_bind.tobytes())
    ibm_accessor = append_accessor(document, ibm_view, component_type=5126, count=joint_count, accessor_type="MAT4")
    document["skins"] = [{
        "name": "Flower_BloomRig",
        "inverseBindMatrices": ibm_accessor,
        "skeleton": n(J_ROOT),
        "joints": [n(j) for j in range(joint_count)],
    }]
    mesh_node["skin"] = 0
    scene = document["scenes"][document.get("scene", 0)]
    scene.setdefault("nodes", []).append(n(J_ROOT))

    # Animation: bud (t < bud_hold) -> open (t >= bud_hold + open_time), then hold.
    rng = np.random.default_rng(seed)
    sample_count = int(duration * 30) + 1
    times = np.linspace(0, duration, sample_count, dtype="<f4")
    time_view = append_buffer_view(document, binary, times.tobytes())
    time_accessor = append_accessor(
        document, time_view, component_type=5126, count=sample_count, accessor_type="SCALAR",
        minimum=[0], maximum=[duration])

    samplers, channels = [], []

    def add_channel(node, path, values):
        view = append_buffer_view(document, binary, np.ascontiguousarray(values, dtype="<f4").tobytes())
        accessor = append_accessor(
            document, view, component_type=5126, count=sample_count,
            accessor_type="VEC4" if path == "rotation" else "VEC3")
        samplers.append({"input": time_accessor, "output": accessor, "interpolation": "LINEAR"})
        channels.append({"sampler": len(samplers) - 1, "target": {"node": node, "path": path}})

    def progress(offset):
        return smoothstep((times.astype(np.float64) - bud_hold - offset) / open_time)

    closed = 1.0 - progress(0.0)
    # Disc shrinks inside the bud and swells as it opens.
    disc_scale = 1.0 - 0.55 * closed
    add_channel(n(J_DISC), "scale", np.stack([disc_scale] * 3, axis=1))
    # Whole head is slightly smaller as a bud.
    head_scale = 1.0 - 0.10 * closed
    add_channel(n(J_HEAD), "scale", np.stack([head_scale] * 3, axis=1))

    inward = petal_r0 * 0.40  # petal bases pull toward the axis so the bud closes over the disc
    for k, d in enumerate(sector_dirs):
        p = progress(float(rng.uniform(0.0, 0.5)))
        c = 1.0 - p
        lift_axis = np.array([-d[2], 0.0, d[0]])  # positive angle lifts the petal toward +Y
        # The scanned petals droop ~30 degrees, so lifting past vertical and a
        # strong tip curl are needed for the tips to fold inward over the disc.
        base_angle = np.radians(96.0 + rng.uniform(-4, 4)) * c
        tip_angle = np.radians(92.0 + rng.uniform(-8, 8)) * c
        add_channel(n(petal_base(k)), "rotation", axis_angle_quat(lift_axis, base_angle))
        add_channel(n(petal_tip(k)), "rotation", axis_angle_quat(lift_axis, tip_angle))
        # Petals are shorter inside the bud.
        petal_scale = 1.0 - 0.22 * c
        add_channel(n(petal_base(k)), "scale", np.stack([petal_scale] * 3, axis=1))
        base_rest = np.asarray(nodes[petal_base(k)]["translation"])
        offset = (-d * inward + np.array([0.0, 0.06, 0.0]))[None, :] * c[:, None]
        add_channel(n(petal_base(k)), "translation", base_rest[None, :] + offset)

    document["animations"] = [{"name": "bloom", "samplers": samplers, "channels": channels}]
    document.setdefault("asset", {})["generator"] = "Neocean flower bloom rig (radial fishbone)"
    write_glb(output, document, binary)

    print(f"Source: {source.name}; vertices {count:,}")
    print(f"Classes: petal {int(petal.sum()):,}, disc {int(disc.sum()):,}, stem {int(stem_mask.sum()):,}")
    print(f"Petal ring r0={petal_r0:.3f} r1={petal_r1:.3f} y0={petal_y0:.3f}; head y={head_y:.3f}")
    print(f"Joints: {joint_count} ({sectors} petal sectors x 2); animation 'bloom' {duration:.1f}s "
          f"(bud {bud_hold:.1f}s, opening {open_time:.1f}s)")
    print(f"Output: {output} ({output.stat().st_size / 1024 / 1024:.1f} MiB)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--sectors", type=int, default=18)
    parser.add_argument("--duration", type=float, default=6.0)
    parser.add_argument("--bud-hold", type=float, default=0.6)
    parser.add_argument("--open-time", type=float, default=3.6)
    args = parser.parse_args()
    add_bloom_rig(args.source, args.output, sectors=args.sectors, duration=args.duration,
                  bud_hold=args.bud_hold, open_time=args.open_time)


if __name__ == "__main__":
    main()

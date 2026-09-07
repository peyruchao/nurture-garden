#!/usr/bin/env python3
"""Add a conservative five-joint fish rig to a static fish GLB.

The body/head remain rigid. Only the rear portion of the fish receives smooth
weights across three tail joints. A separate root and rigid body joint mirror
the conventional hierarchy used by animated fish assets while keeping the
head stable and producing a small looping side-to-side swim
without requiring the original Unity ETCFish source rig.
"""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import numpy as np

from retarget_manta_skin import (
    accessor_array,
    append_accessor,
    append_buffer_view,
    first_primitive,
    make_material_streaming_compatible,
    read_glb,
    write_glb,
)


def add_tail_rig(source: Path, output: Path, *, tail_direction: str, duration: float = 2.2):
    document, binary = read_glb(source)
    if document.get("skins") or document.get("animations"):
        raise ValueError(f"Source already contains a skin or animation: {source}")

    primitive = first_primitive(document)
    positions = accessor_array(
        document,
        binary,
        primitive["attributes"]["POSITION"],
    ).astype(np.float32, copy=True)

    low = positions.min(axis=0)
    high = positions.max(axis=0)
    span = high - low
    axis = int(np.argmax(span))
    if axis != 2:
        raise ValueError(f"Expected fish length on Z, found axis {axis}")

    tail_sign = -1.0 if tail_direction == "negative" else 1.0
    axis_min = float(low[axis])
    axis_max = float(high[axis])
    axis_span = axis_max - axis_min
    tail_base = axis_min + axis_span * (0.38 if tail_sign < 0 else 0.62)
    tail_mid = axis_min + axis_span * (0.18 if tail_sign < 0 else 0.82)
    tail_tip = axis_min + axis_span * (0.015 if tail_sign < 0 else 0.985)

    if tail_sign < 0:
        tailness = np.clip((tail_base - positions[:, axis]) / (tail_base - axis_min), 0, 1)
    else:
        tailness = np.clip((positions[:, axis] - tail_base) / (axis_max - tail_base), 0, 1)

    count = len(positions)
    joints = np.zeros((count, 4), dtype=np.uint8)
    weights = np.zeros((count, 4), dtype=np.uint8)
    # Joint 0 is the skeleton root; joint 1 is the rigid body/head bone.
    joints[:, 0] = 1
    weights[:, 0] = 255

    def assign_blend(mask, joint_a, joint_b, blend):
        blend_u8 = np.rint(np.clip(blend, 0, 1) * 255).astype(np.uint8)
        rows = np.flatnonzero(mask)
        joints[rows, 0] = joint_a
        joints[rows, 1] = joint_b
        weights[rows, 0] = 255 - blend_u8
        weights[rows, 1] = blend_u8
        weights[rows, 2:] = 0

    zone1 = (tailness > 0) & (tailness <= 0.36)
    zone2 = (tailness > 0.36) & (tailness <= 0.72)
    zone3 = tailness > 0.72
    assign_blend(zone1, 1, 2, tailness[zone1] / 0.36)
    assign_blend(zone2, 2, 3, (tailness[zone2] - 0.36) / 0.36)
    assign_blend(zone3, 3, 4, (tailness[zone3] - 0.72) / 0.28)
    # Strict converters reject non-zero joint indices in slots whose rounded
    # normalized byte weight is zero. Clear those unused indices explicitly.
    joints[weights == 0] = 0

    joints_view = append_buffer_view(document, binary, joints.tobytes(), target=34962)
    weights_view = append_buffer_view(document, binary, weights.tobytes(), target=34962)
    joints_accessor = append_accessor(
        document, joints_view,
        component_type=5121, count=count, accessor_type="VEC4",
    )
    weights_accessor = append_accessor(
        document, weights_view,
        component_type=5121, count=count, accessor_type="VEC4",
    )
    document["accessors"][weights_accessor]["normalized"] = True
    primitive["attributes"]["JOINTS_0"] = joints_accessor
    primitive["attributes"]["WEIGHTS_0"] = weights_accessor

    mesh_node_index = next(i for i, node in enumerate(document["nodes"]) if "mesh" in node)
    joint_offset = len(document["nodes"])
    base_vector = [0.0, 0.0, 0.0]
    base_vector[axis] = tail_base
    mid_vector = [0.0, 0.0, 0.0]
    mid_vector[axis] = tail_mid - tail_base
    tip_vector = [0.0, 0.0, 0.0]
    tip_vector[axis] = tail_tip - tail_mid
    document["nodes"].extend([
        {"name": "Fish_Root", "children": [joint_offset + 1]},
        {"name": "Fish_Body", "children": [joint_offset + 2]},
        {"name": "Fish_TailBase", "translation": base_vector, "children": [joint_offset + 3]},
        {"name": "Fish_TailMid", "translation": mid_vector, "children": [joint_offset + 4]},
        {"name": "Fish_TailTip", "translation": tip_vector},
    ])

    inverse_bind = np.repeat(np.eye(4, dtype="<f4")[None, :, :], 5, axis=0)
    joint_world_positions = [0.0, 0.0, tail_base, tail_mid, tail_tip]
    for matrix, coordinate in zip(inverse_bind, joint_world_positions):
        matrix.flat[12 + axis] = -coordinate
    ibm_view = append_buffer_view(document, binary, inverse_bind.tobytes())
    ibm_accessor = append_accessor(
        document, ibm_view,
        component_type=5126, count=5, accessor_type="MAT4",
    )
    document["skins"] = [{
        "name": "ETCFish_SimpleTailRig",
        "inverseBindMatrices": ibm_accessor,
        "skeleton": joint_offset,
        "joints": [joint_offset + i for i in range(5)],
    }]
    document["nodes"][mesh_node_index]["skin"] = 0
    scene = document["scenes"][document.get("scene", 0)]
    scene.setdefault("nodes", []).append(joint_offset)

    sample_count = 45
    times = np.linspace(0, duration, sample_count, dtype="<f4")
    time_view = append_buffer_view(document, binary, times.tobytes())
    time_accessor = append_accessor(
        document, time_view,
        component_type=5126, count=sample_count, accessor_type="SCALAR",
        minimum=[0], maximum=[duration],
    )

    samplers = []
    channels = []
    amplitudes = [4.0, 7.0, 10.0]
    for i, amplitude_deg in enumerate(amplitudes):
        angles = np.sin(times / duration * math.tau) * math.radians(amplitude_deg) * tail_sign
        rotations = np.zeros((sample_count, 4), dtype="<f4")
        rotations[:, 1] = np.sin(angles * 0.5)
        rotations[:, 3] = np.cos(angles * 0.5)
        rotation_view = append_buffer_view(document, binary, rotations.tobytes())
        rotation_accessor = append_accessor(
            document, rotation_view,
            component_type=5126, count=sample_count, accessor_type="VEC4",
        )
        samplers.append({
            "input": time_accessor,
            "output": rotation_accessor,
            "interpolation": "LINEAR",
        })
        channels.append({
            "sampler": i,
            "target": {"node": joint_offset + i + 2, "path": "rotation"},
        })
    document["animations"] = [{"name": "swim", "samplers": samplers, "channels": channels}]

    make_material_streaming_compatible(document)
    document.setdefault("asset", {})["generator"] = "Neocean streaming-ready fish tail rig"
    write_glb(output, document, binary)

    rigid_count = int(np.count_nonzero(tailness == 0))
    print(f"Source: {source.name}")
    print(f"Vertices: {count:,}; rigid body/head: {rigid_count:,} ({rigid_count / count:.1%})")
    print(f"Tail direction: {tail_direction} Z; joints at {tail_base:.4f}, {tail_mid:.4f}, {tail_tip:.4f}")
    print(f"Animation: swim, {duration:.1f}s, amplitudes {amplitudes} degrees")
    print(f"Output: {output} ({output.stat().st_size / 1024 / 1024:.1f} MiB)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--tail", choices=("negative", "positive"), required=True)
    parser.add_argument("--duration", type=float, default=2.2)
    args = parser.parse_args()
    add_tail_rig(args.source, args.output, tail_direction=args.tail, duration=args.duration)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
"""Transfer a Manta GLB skin and animation onto a static Eagle Ray GLB.

The transfer aligns the two meshes by their local bounding boxes and copies
JOINTS_0 / WEIGHTS_0 from the nearest Manta surface vertex. The Eagle mesh,
UVs, material, textures, and indices remain intact.
"""

from __future__ import annotations

import argparse
import copy
import json
import math
import struct
from pathlib import Path

import numpy as np


JSON_CHUNK = 0x4E4F534A
BIN_CHUNK = 0x004E4942
COMPONENT_DTYPES = {
    5120: np.dtype("<i1"),
    5121: np.dtype("<u1"),
    5122: np.dtype("<i2"),
    5123: np.dtype("<u2"),
    5125: np.dtype("<u4"),
    5126: np.dtype("<f4"),
}
TYPE_COMPONENTS = {
    "SCALAR": 1,
    "VEC2": 2,
    "VEC3": 3,
    "VEC4": 4,
    "MAT2": 4,
    "MAT3": 9,
    "MAT4": 16,
}


def read_glb(path: Path):
    raw = path.read_bytes()
    magic, version, total = struct.unpack_from("<4sII", raw, 0)
    if magic != b"glTF" or version != 2 or total != len(raw):
        raise ValueError(f"Invalid GLB 2.0 file: {path}")
    offset = 12
    document = None
    binary = None
    while offset < len(raw):
        length, chunk_type = struct.unpack_from("<II", raw, offset)
        offset += 8
        payload = raw[offset:offset + length]
        offset += length
        if chunk_type == JSON_CHUNK:
            document = json.loads(payload.rstrip(b" \t\r\n\0").decode("utf-8"))
        elif chunk_type == BIN_CHUNK:
            binary = bytearray(payload)
    if document is None or binary is None:
        raise ValueError(f"Missing JSON or BIN chunk: {path}")
    return document, binary


def accessor_array(document, binary, accessor_index, writable=False):
    accessor = document["accessors"][accessor_index]
    if "sparse" in accessor:
        raise ValueError("Sparse accessors are not supported by this transfer tool")
    view = document["bufferViews"][accessor["bufferView"]]
    dtype = COMPONENT_DTYPES[accessor["componentType"]]
    components = TYPE_COMPONENTS[accessor["type"]]
    item_bytes = dtype.itemsize * components
    stride = view.get("byteStride", item_bytes)
    offset = view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
    buffer = binary if writable else bytes(binary)
    array = np.ndarray(
        (accessor["count"], components),
        dtype=dtype,
        buffer=buffer,
        offset=offset,
        strides=(stride, dtype.itemsize),
    )
    return array


def mesh_node_index(document):
    for index, node in enumerate(document.get("nodes", [])):
        if "mesh" in node:
            return index
    raise ValueError("No mesh node found")


def first_primitive(document):
    node = document["nodes"][mesh_node_index(document)]
    return document["meshes"][node["mesh"]]["primitives"][0]


def width_profile(points, bins=32):
    low = points.min(axis=0)
    span = np.maximum(points.max(axis=0) - low, 1e-8)
    norm = (points - low) / span
    profile = np.zeros(bins, dtype=np.float64)
    for i in range(bins):
        mask = (norm[:, 2] >= i / bins) & (norm[:, 2] < (i + 1) / bins)
        if np.any(mask):
            profile[i] = np.quantile(np.abs(norm[mask, 0] - 0.5), 0.98)
    return profile


def choose_z_orientation(eagle_positions, manta_positions):
    eagle_profile = width_profile(eagle_positions)
    manta_profile = width_profile(manta_positions)
    direct = np.corrcoef(eagle_profile, manta_profile)[0, 1]
    reversed_score = np.corrcoef(eagle_profile[::-1], manta_profile)[0, 1]
    reverse = bool(np.nan_to_num(reversed_score, nan=-1) > np.nan_to_num(direct, nan=-1))
    return reverse, float(direct), float(reversed_score)


def nearest_surface_neighbors(query, reference, grid_size=28, neighbor_count=8):
    ref_cells = np.clip((reference * grid_size).astype(np.int32), 0, grid_size - 1)
    query_cells = np.clip((query * grid_size).astype(np.int32), 0, grid_size - 1)

    buckets = {}
    for index, cell in enumerate(ref_cells):
        buckets.setdefault(tuple(int(v) for v in cell), []).append(index)
    buckets = {key: np.asarray(value, dtype=np.int32) for key, value in buckets.items()}

    linear = (
        query_cells[:, 0] * grid_size * grid_size
        + query_cells[:, 1] * grid_size
        + query_cells[:, 2]
    )
    order = np.argsort(linear, kind="stable")
    sorted_linear = linear[order]
    boundaries = np.flatnonzero(np.r_[True, sorted_linear[1:] != sorted_linear[:-1], True])
    result = np.empty((len(query), neighbor_count), dtype=np.int32)
    result_distance2 = np.empty((len(query), neighbor_count), dtype=np.float32)

    for group_index in range(len(boundaries) - 1):
        query_ids = order[boundaries[group_index]:boundaries[group_index + 1]]
        cell = query_cells[query_ids[0]]
        candidates = []
        for radius in range(1, grid_size):
            candidates.clear()
            x0, y0, z0 = (int(v) for v in cell)
            for x in range(max(0, x0 - radius), min(grid_size, x0 + radius + 1)):
                for y in range(max(0, y0 - radius), min(grid_size, y0 + radius + 1)):
                    for z in range(max(0, z0 - radius), min(grid_size, z0 + radius + 1)):
                        found = buckets.get((x, y, z))
                        if found is not None:
                            candidates.append(found)
            if sum(len(found) for found in candidates) >= neighbor_count:
                break
        if not candidates:
            candidate_ids = np.arange(len(reference), dtype=np.int32)
        else:
            candidate_ids = np.unique(np.concatenate(candidates))

        candidate_points = reference[candidate_ids]
        for start in range(0, len(query_ids), 2048):
            ids = query_ids[start:start + 2048]
            delta = query[ids, None, :] - candidate_points[None, :, :]
            distance2 = np.einsum("ijk,ijk->ij", delta, delta, optimize=True)
            count = min(neighbor_count, len(candidate_ids))
            local = np.argpartition(distance2, count - 1, axis=1)[:, :count]
            local_distance2 = np.take_along_axis(distance2, local, axis=1)
            local_order = np.argsort(local_distance2, axis=1)
            local = np.take_along_axis(local, local_order, axis=1)
            local_distance2 = np.take_along_axis(local_distance2, local_order, axis=1)
            result[ids, :count] = candidate_ids[local]
            result_distance2[ids, :count] = local_distance2
            if count < neighbor_count:
                result[ids, count:] = result[ids, count - 1:count]
                result_distance2[ids, count:] = result_distance2[ids, count - 1:count]
    return result, result_distance2


def blend_neighbor_weights(neighbors, distance2, manta_joints, manta_weights, joint_count):
    output_joints = np.empty((len(neighbors), 4), dtype=np.uint16)
    output_weights = np.empty((len(neighbors), 4), dtype=np.float32)
    for start in range(0, len(neighbors), 8192):
        end = min(start + 8192, len(neighbors))
        ids = neighbors[start:end]
        distances = distance2[start:end]
        proximity = 1.0 / np.maximum(distances, 1e-7)
        proximity /= proximity.sum(axis=1, keepdims=True)
        joints = manta_joints[ids]
        weights = manta_weights[ids] * proximity[:, :, None]
        combined = np.zeros((end - start, joint_count), dtype=np.float32)
        rows = np.broadcast_to(
            np.arange(end - start, dtype=np.int32)[:, None, None],
            joints.shape,
        )
        np.add.at(combined, (rows.ravel(), joints.ravel()), weights.ravel())
        top = np.argpartition(combined, -4, axis=1)[:, -4:]
        top_weights = np.take_along_axis(combined, top, axis=1)
        order = np.argsort(top_weights, axis=1)[:, ::-1]
        top = np.take_along_axis(top, order, axis=1)
        top_weights = np.take_along_axis(top_weights, order, axis=1)
        top_weights /= np.maximum(top_weights.sum(axis=1, keepdims=True), 1e-8)
        output_joints[start:end] = top.astype(np.uint16)
        output_weights[start:end] = top_weights
    return output_joints, output_weights


def damp_manta_animation(document, binary, strength):
    processed = set()
    for animation in document.get("animations", []):
        for channel in animation.get("channels", []):
            sampler = animation["samplers"][channel["sampler"]]
            accessor_index = sampler["output"]
            key = (accessor_index, channel["target"]["path"])
            if key in processed:
                continue
            processed.add(key)
            values = accessor_array(document, binary, accessor_index, writable=True)
            path = channel["target"]["path"]
            node = document["nodes"][channel["target"]["node"]]
            cubic = sampler.get("interpolation") == "CUBICSPLINE"
            value_rows = values[1::3] if cubic else values
            if cubic:
                values[0::3] *= strength
                values[2::3] *= strength
            if path == "translation":
                rest = np.asarray(node.get("translation", [0, 0, 0]), dtype=np.float32)
                value_rows[:] = rest + (value_rows - rest) * strength
            elif path == "scale":
                rest = np.asarray(node.get("scale", [1, 1, 1]), dtype=np.float32)
                value_rows[:] = rest + (value_rows - rest) * strength
            elif path == "rotation":
                rest = np.asarray(node.get("rotation", [0, 0, 0, 1]), dtype=np.float32)
                dot = np.sum(value_rows * rest, axis=1, keepdims=True)
                signed = np.where(dot < 0, -value_rows, value_rows)
                blended = rest + (signed - rest) * strength
                blended /= np.maximum(np.linalg.norm(blended, axis=1, keepdims=True), 1e-8)
                value_rows[:] = blended


def align_eagle_to_manta(eagle_positions, eagle_normals, manta_positions, reverse_z):
    eagle_min = eagle_positions.min(axis=0)
    eagle_span = np.maximum(eagle_positions.max(axis=0) - eagle_min, 1e-8)
    manta_min = manta_positions.min(axis=0)
    manta_span = np.maximum(manta_positions.max(axis=0) - manta_min, 1e-8)

    normalized = (eagle_positions - eagle_min) / eagle_span
    if reverse_z:
        normalized[:, 2] = 1.0 - normalized[:, 2]
    aligned = manta_min + normalized * manta_span

    signed_scale = manta_span / eagle_span
    if reverse_z:
        signed_scale[2] *= -1
    transformed_normals = eagle_normals / signed_scale
    transformed_normals /= np.maximum(
        np.linalg.norm(transformed_normals, axis=1, keepdims=True),
        1e-8,
    )
    return normalized, aligned.astype(np.float32), transformed_normals.astype(np.float32)


def pad4(binary: bytearray):
    while len(binary) % 4:
        binary.append(0)


def append_buffer_view(document, binary, payload, *, target=None, byte_stride=None):
    pad4(binary)
    offset = len(binary)
    binary.extend(payload)
    view = {"buffer": 0, "byteOffset": offset, "byteLength": len(payload)}
    if target is not None:
        view["target"] = target
    if byte_stride is not None:
        view["byteStride"] = byte_stride
    document.setdefault("bufferViews", []).append(view)
    return len(document["bufferViews"]) - 1


def append_accessor(document, view_index, *, component_type, count, accessor_type, minimum=None, maximum=None):
    accessor = {
        "bufferView": view_index,
        "componentType": component_type,
        "count": int(count),
        "type": accessor_type,
    }
    if minimum is not None:
        accessor["min"] = [float(value) for value in minimum]
    if maximum is not None:
        accessor["max"] = [float(value) for value in maximum]
    document.setdefault("accessors", []).append(accessor)
    return len(document["accessors"]) - 1


def copy_accessor(source_doc, source_bin, target_doc, target_bin, accessor_index, accessor_cache, view_cache):
    if accessor_index in accessor_cache:
        return accessor_cache[accessor_index]
    accessor = copy.deepcopy(source_doc["accessors"][accessor_index])
    if "sparse" in accessor:
        raise ValueError("Sparse Manta animation accessors are not supported")
    source_view_index = accessor["bufferView"]
    source_view = source_doc["bufferViews"][source_view_index]
    if source_view_index in view_cache:
        new_view = view_cache[source_view_index]
    else:
        start = source_view.get("byteOffset", 0)
        end = start + source_view["byteLength"]
        new_view = append_buffer_view(
            target_doc,
            target_bin,
            source_bin[start:end],
            target=source_view.get("target"),
            byte_stride=source_view.get("byteStride"),
        )
        view_cache[source_view_index] = new_view
    accessor["bufferView"] = new_view
    target_doc.setdefault("accessors", []).append(accessor)
    result = len(target_doc["accessors"]) - 1
    accessor_cache[accessor_index] = result
    return result


def write_glb(path, document, binary):
    pad4(binary)
    document["buffers"] = [{"byteLength": len(binary)}]
    json_bytes = json.dumps(document, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    json_bytes += b" " * ((4 - len(json_bytes) % 4) % 4)
    total = 12 + 8 + len(json_bytes) + 8 + len(binary)
    output = bytearray(struct.pack("<4sII", b"glTF", 2, total))
    output.extend(struct.pack("<II", len(json_bytes), JSON_CHUNK))
    output.extend(json_bytes)
    output.extend(struct.pack("<II", len(binary), BIN_CHUNK))
    output.extend(binary)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(output)


def make_material_streaming_compatible(document):
    """Keep the colour texture while avoiding overly reflective XRG output.

    The source generated material marks an organic animal as fully metallic and
    also supplies an ORM texture. Some conversion/viewer combinations render
    that material as a nearly white mirror. A dielectric, moderately rough
    material is both physically appropriate and more widely supported.
    """
    for material in document.get("materials", []):
        pbr = material.setdefault("pbrMetallicRoughness", {})
        pbr["metallicFactor"] = 0.0
        pbr["roughnessFactor"] = 0.72
        pbr.pop("metallicRoughnessTexture", None)
        if "baseColorTexture" in pbr:
            pbr["baseColorTexture"]["texCoord"] = 0
        # Normal maps without exported tangents are inconsistently handled by
        # streaming converters. The colour texture is the important identity
        # texture, so prefer stable generated normals for this retargeted mesh.
        material.pop("normalTexture", None)
        material["doubleSided"] = True


def transfer(eagle_path, manta_path, output_path, animation_strength=0.38):
    eagle_doc, eagle_bin = read_glb(eagle_path)
    manta_doc, manta_bin = read_glb(manta_path)
    eagle_primitive = first_primitive(eagle_doc)
    manta_primitive = first_primitive(manta_doc)

    eagle_positions = accessor_array(eagle_doc, eagle_bin, eagle_primitive["attributes"]["POSITION"]).astype(np.float32, copy=True)
    eagle_normals = accessor_array(eagle_doc, eagle_bin, eagle_primitive["attributes"]["NORMAL"]).astype(np.float32, copy=True)
    manta_positions = accessor_array(manta_doc, manta_bin, manta_primitive["attributes"]["POSITION"]).astype(np.float32, copy=True)
    manta_joints = accessor_array(manta_doc, manta_bin, manta_primitive["attributes"]["JOINTS_0"]).astype(np.uint16, copy=True)
    manta_weights = accessor_array(manta_doc, manta_bin, manta_primitive["attributes"]["WEIGHTS_0"]).astype(np.float32, copy=True)

    reverse_z, direct_score, reverse_score = choose_z_orientation(eagle_positions, manta_positions)
    normalized, aligned_positions, aligned_normals = align_eagle_to_manta(
        eagle_positions,
        eagle_normals,
        manta_positions,
        reverse_z,
    )
    manta_min = manta_positions.min(axis=0)
    manta_span = np.maximum(manta_positions.max(axis=0) - manta_min, 1e-8)
    manta_normalized = (manta_positions - manta_min) / manta_span

    print(f"Eagle vertices: {len(eagle_positions):,}")
    print(f"Manta vertices: {len(manta_positions):,}")
    print(f"Z profile correlation direct={direct_score:.3f}, reversed={reverse_score:.3f}; reverse_z={reverse_z}")
    neighbors, neighbor_distance2 = nearest_surface_neighbors(normalized, manta_normalized)
    transferred_joints, transferred_weights = blend_neighbor_weights(
        neighbors,
        neighbor_distance2,
        manta_joints,
        manta_weights,
        len(manta_doc["skins"][0]["joints"]),
    )

    # Keep the central head/nose rigid on the root joint. It follows the whole
    # animal but does not inherit local jaw/head deformation from the Manta.
    head_width = 0.20 + np.clip((normalized[:, 2] - 0.66) / 0.34, 0, 1) * 0.16
    head_mask = (normalized[:, 2] >= 0.66) & (np.abs(normalized[:, 0] - 0.5) <= head_width)
    transferred_joints[head_mask] = np.array([0, 0, 0, 0], dtype=np.uint16)
    transferred_weights[head_mask] = np.array([1, 0, 0, 0], dtype=np.float32)

    damp_manta_animation(manta_doc, manta_bin, animation_strength)

    position_index = eagle_primitive["attributes"]["POSITION"]
    normal_index = eagle_primitive["attributes"]["NORMAL"]
    accessor_array(eagle_doc, eagle_bin, position_index, writable=True)[:] = aligned_positions
    accessor_array(eagle_doc, eagle_bin, normal_index, writable=True)[:] = aligned_normals
    eagle_doc["accessors"][position_index]["min"] = aligned_positions.min(axis=0).astype(float).tolist()
    eagle_doc["accessors"][position_index]["max"] = aligned_positions.max(axis=0).astype(float).tolist()
    eagle_doc["accessors"][normal_index]["min"] = aligned_normals.min(axis=0).astype(float).tolist()
    eagle_doc["accessors"][normal_index]["max"] = aligned_normals.max(axis=0).astype(float).tolist()

    joints_view = append_buffer_view(eagle_doc, eagle_bin, transferred_joints.astype("<u2").tobytes(), target=34962)
    weights_view = append_buffer_view(eagle_doc, eagle_bin, transferred_weights.astype("<f4").tobytes(), target=34962)
    joints_accessor = append_accessor(
        eagle_doc,
        joints_view,
        component_type=5123,
        count=len(transferred_joints),
        accessor_type="VEC4",
    )
    weights_accessor = append_accessor(
        eagle_doc,
        weights_view,
        component_type=5126,
        count=len(transferred_weights),
        accessor_type="VEC4",
        minimum=transferred_weights.min(axis=0),
        maximum=transferred_weights.max(axis=0),
    )
    eagle_primitive["attributes"]["JOINTS_0"] = joints_accessor
    eagle_primitive["attributes"]["WEIGHTS_0"] = weights_accessor

    accessor_cache = {}
    view_cache = {}
    node_offset = len(eagle_doc.get("nodes", []))
    imported_nodes = copy.deepcopy(manta_doc["nodes"])
    for node in imported_nodes:
        if "children" in node:
            node["children"] = [child + node_offset for child in node["children"]]
        node.pop("camera", None)
        node.pop("extensions", None)
        node.pop("mesh", None)
        node.pop("skin", None)

    manta_mesh_node = mesh_node_index(manta_doc)
    imported_nodes[manta_mesh_node]["mesh"] = 0
    imported_nodes[manta_mesh_node]["skin"] = 0
    eagle_doc.setdefault("nodes", []).extend(imported_nodes)

    source_skin = copy.deepcopy(manta_doc["skins"][0])
    source_skin["joints"] = [joint + node_offset for joint in source_skin["joints"]]
    if "skeleton" in source_skin:
        source_skin["skeleton"] += node_offset
    if "inverseBindMatrices" in source_skin:
        source_skin["inverseBindMatrices"] = copy_accessor(
            manta_doc,
            manta_bin,
            eagle_doc,
            eagle_bin,
            source_skin["inverseBindMatrices"],
            accessor_cache,
            view_cache,
        )
    eagle_doc["skins"] = [source_skin]

    animations = []
    for source_animation in manta_doc.get("animations", []):
        animation = copy.deepcopy(source_animation)
        for sampler in animation.get("samplers", []):
            sampler["input"] = copy_accessor(
                manta_doc, manta_bin, eagle_doc, eagle_bin, sampler["input"], accessor_cache, view_cache
            )
            sampler["output"] = copy_accessor(
                manta_doc, manta_bin, eagle_doc, eagle_bin, sampler["output"], accessor_cache, view_cache
            )
        for channel in animation.get("channels", []):
            channel["target"]["node"] += node_offset
        animations.append(animation)
    eagle_doc["animations"] = animations

    make_material_streaming_compatible(eagle_doc)

    manta_scene = manta_doc.get("scenes", [{}])[manta_doc.get("scene", 0)]
    eagle_doc["scenes"] = [{"name": "Eagle Ray with Manta rig", "nodes": [node + node_offset for node in manta_scene.get("nodes", [])]}]
    eagle_doc["scene"] = 0
    eagle_doc.setdefault("asset", {})["generator"] = "Neocean automatic Manta-to-Eagle skin transfer"
    write_glb(output_path, eagle_doc, eagle_bin)

    print(f"Transferred joints: {len(source_skin['joints'])}")
    print(f"Rigid head vertices: {int(head_mask.sum()):,}")
    print(f"Animation strength: {animation_strength:.2f}")
    print(f"Animations: {[animation.get('name', '<unnamed>') for animation in animations]}")
    print(f"Output: {output_path} ({output_path.stat().st_size / 1024 / 1024:.1f} MiB)")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("eagle", type=Path)
    parser.add_argument("manta", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--animation-strength", type=float, default=0.38)
    args = parser.parse_args()
    transfer(args.eagle, args.manta, args.output, args.animation_strength)


if __name__ == "__main__":
    main()

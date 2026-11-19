#!/usr/bin/env python3
"""
Gives the model real toes.

    python3 tools/fit_toes.py path/to/makehuman/base.obj [--model src/assets/model/legs.glb]

The leg in legs.glb is the MakeHuman base mesh (CC0), and its "stocking" mesh was fitted over that leg as one
closed shape, toes included. This tool brings the toes back from the MakeHuman mesh
(https://github.com/makehumancommunity/makehuman, makehuman/data/3dobjs/base.obj): it places the MakeHuman foot
on the model and writes its forefoot into the model file as a third mesh, "forefoot", which the app subdivides
and draws as the skin of a bare foot and under a stocking. The mesh carries how deep each vertex lies between two
toes (_SHADE) and, in its extras, the toenails.

Needs numpy and scipy. The result is deterministic; running it on an already fitted model changes nothing.
"""
import argparse
import json
import struct
import sys

import numpy as np
from scipy.spatial import cKDTree

WRAP_UNIT = 1e-5


# ---------------------------------------------------------------------------------------------------------------
# Model file
# ---------------------------------------------------------------------------------------------------------------

COMPONENTS = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
DTYPES = {5120: np.int8, 5121: np.uint8, 5122: np.int16, 5123: np.uint16, 5125: np.uint32, 5126: np.float32}


class Glb:
    """A glTF binary whose accessors can be read, replaced and appended."""

    def __init__(self, path):
        data = open(path, "rb").read()
        magic, version, _ = struct.unpack_from("<III", data, 0)
        if magic != 0x46546C67 or version != 2:
            raise SystemExit(f"{path} is not a glTF 2.0 binary")
        json_length = struct.unpack_from("<I", data, 12)[0]
        self.gltf = json.loads(data[20 : 20 + json_length])
        bin_start = 20 + json_length + 8
        bin_length = struct.unpack_from("<I", data, 20 + json_length)[0]
        binary = data[bin_start : bin_start + bin_length]
        # One byte string per buffer view, so views can change size.
        self.views = [
            bytearray(binary[view.get("byteOffset", 0) : view.get("byteOffset", 0) + view["byteLength"]])
            for view in self.gltf["bufferViews"]
        ]

    def read(self, accessor_index):
        accessor = self.gltf["accessors"][accessor_index]
        dtype = DTYPES[accessor["componentType"]]
        width = COMPONENTS[accessor["type"]]
        raw = np.frombuffer(
            bytes(self.views[accessor["bufferView"]]),
            dtype=dtype,
            count=accessor["count"] * width,
            offset=accessor.get("byteOffset", 0),
        )
        return raw.reshape(-1, width) if width > 1 else raw.copy()

    def replace(self, accessor_index, array):
        accessor = self.gltf["accessors"][accessor_index]
        array = np.ascontiguousarray(array, dtype=DTYPES[accessor["componentType"]])
        accessor["count"] = len(array)
        self.views[accessor["bufferView"]] = bytearray(array.tobytes())

    def append(self, name, array, component_type, kind, normalized=False):
        array = np.ascontiguousarray(array, dtype=DTYPES[component_type])
        self.views.append(bytearray(array.tobytes()))
        self.gltf["bufferViews"].append({"buffer": 0, "name": name})
        accessor = {
            "bufferView": len(self.views) - 1,
            "componentType": component_type,
            "count": len(array),
            "type": kind,
            "name": name,
        }
        if normalized:
            accessor["normalized"] = True
        self.gltf["accessors"].append(accessor)
        return len(self.gltf["accessors"]) - 1

    def drop_trailing_accessors(self, first):
        """Removes the accessors from `first` on, with their buffer views (they must be the last ones)."""
        accessors = self.gltf["accessors"]
        views = sorted({accessor["bufferView"] for accessor in accessors[first:]})
        if views and views != list(range(views[0], len(self.views))):
            raise SystemExit("cannot remove accessors that share or precede other buffer views")
        del accessors[first:]
        if views:
            del self.views[views[0] :]
            del self.gltf["bufferViews"][views[0] :]

    def write(self, path):
        binary = bytearray()
        for view, data in zip(self.gltf["bufferViews"], self.views):
            binary += b"\0" * (-len(binary) % 4)
            view["byteOffset"] = len(binary)
            view["byteLength"] = len(data)
            binary += data
        binary += b"\0" * (-len(binary) % 4)
        self.gltf["buffers"][0]["byteLength"] = len(binary)
        text = json.dumps(self.gltf, separators=(",", ":")).encode()
        text += b" " * (-len(text) % 4)
        total = 12 + 8 + len(text) + 8 + len(binary)
        with open(path, "wb") as out:
            out.write(struct.pack("<III", 0x46546C67, 2, total))
            out.write(struct.pack("<II", len(text), 0x4E4F534A) + text)
            out.write(struct.pack("<II", len(binary), 0x004E4942) + bytes(binary))


# ---------------------------------------------------------------------------------------------------------------
# The app's mesh pipeline (src/engine/geometry), reproduced so vertices get the same numbers here
# ---------------------------------------------------------------------------------------------------------------


def weld_vertices(positions):
    """Maps each vertex to the first vertex sharing its (rounded) position, like weldVertices in weld.ts."""
    # JavaScript's Math.round rounds halves up.
    keys = np.floor(positions.astype(np.float64) * 100000 + 0.5).astype(np.int64)
    _, first, inverse = np.unique(keys, axis=0, return_index=True, return_inverse=True)
    return first[inverse.reshape(-1)]


def welded_normals(positions, triangles, weld):
    """Smooth normals that ignore UV seams, like computeWeldedNormals in weld.ts."""
    p = positions.astype(np.float64)
    a, b, c = p[triangles[:, 0]], p[triangles[:, 1]], p[triangles[:, 2]]
    face = np.cross(b - a, c - a)
    accum = np.zeros_like(p)
    for k in range(3):
        np.add.at(accum, weld[triangles[:, k]], face)
    accum = accum[weld]
    length = np.linalg.norm(accum, axis=1)
    length[length == 0] = 1
    return (accum / length[:, None]).astype(np.float32)


def subdivide_smooth(positions, triangles):
    """One smooth 1-to-4 subdivision step, like subdivideSmooth in subdivide.ts (positions only)."""
    positions = positions.astype(np.float32)
    weld = weld_vertices(positions)
    normals = welded_normals(positions, triangles, weld).astype(np.float64)
    p = positions.astype(np.float64)
    count = len(positions)
    # Midpoints are created in the order the app meets the edges: per triangle ab, bc, ca.
    corners = triangles[:, [0, 1, 1, 2, 2, 0]].reshape(-1, 2)
    low = np.minimum(corners[:, 0], corners[:, 1]).astype(np.int64)
    high = np.maximum(corners[:, 0], corners[:, 1]).astype(np.int64)
    keys = low * 2097152 + high
    _, first, inverse = np.unique(keys, return_index=True, return_inverse=True)
    order = np.argsort(first, kind="stable")
    rank = np.empty(len(order), dtype=np.int64)
    rank[order] = np.arange(len(order))
    mid_index = count + rank[inverse]
    edge = corners[first[order]]
    wa = np.minimum(weld[edge[:, 0]], weld[edge[:, 1]])
    wb = np.maximum(weld[edge[:, 0]], weld[edge[:, 1]])
    # The app stores the plain midpoint as float32 before projecting it onto the two tangent planes.
    mid = ((p[wa] + p[wb]) / 2).astype(np.float32).astype(np.float64)
    projected = np.zeros_like(mid)
    for v in (wa, wb):
        dist = np.einsum("ij,ij->i", mid - p[v], normals[v])
        projected += (mid - dist[:, None] * normals[v]) / 2
    roundness = 0.75
    new_positions = ((1 - roundness) * mid + roundness * projected).astype(np.float32)
    ab, bc, ca = mid_index[0::3], mid_index[1::3], mid_index[2::3]
    a, b, c = triangles[:, 0], triangles[:, 1], triangles[:, 2]
    new_triangles = np.stack([a, ab, ca, b, bc, ab, c, ca, bc, ab, bc, ca], axis=1).reshape(-1, 3)
    return np.vstack([positions, new_positions]), new_triangles.astype(np.int64)


# ---------------------------------------------------------------------------------------------------------------
# The MakeHuman foot
# ---------------------------------------------------------------------------------------------------------------


def load_makehuman_leg(path):
    """
    The left lower leg of the MakeHuman base mesh as (vertices, quads, toes), in its own units (decimeters).
    toes holds the joints along each toe, big toe first, from the mesh's joint markers.
    """
    vertices, quads, joints, group = [], [], {}, None
    for line in open(path):
        if line.startswith("v "):
            vertices.append([float(value) for value in line.split()[1:4]])
        elif line.startswith("g "):
            group = line.split()[1]
        elif line.startswith("f "):
            corners = [int(corner.split("/")[0]) - 1 for corner in line.split()[1:]]
            if group == "body":
                quads.append(corners)
            elif group.startswith("joint-l-toe-"):
                joints.setdefault(group, set()).update(corners)
    vertices = np.array(vertices)
    quads = np.array(quads)
    toes = [
        np.array([vertices[sorted(joints[name])].mean(axis=0) for name in sorted(joints) if name.startswith(f"joint-l-toe-{toe}-")])
        for toe in range(1, 6)
    ]
    # The left leg is on +x; -6.3 dm is a hand above the ankle.
    keep = (vertices[quads][:, :, 0] > 0).all(axis=1) & (vertices[quads][:, :, 1] < -6.3).all(axis=1)
    return (*compact(vertices, quads[keep]), toes)


def compact(vertices, faces):
    used = np.unique(faces)
    remap = np.full(len(vertices), -1, dtype=np.int64)
    remap[used] = np.arange(len(used))
    return vertices[used], remap[faces]


def catmull_clark(vertices, quads):
    """One Catmull-Clark subdivision step of a quad mesh. Open borders keep their shape."""
    vertex_count, face_count = len(vertices), len(quads)
    face_points = vertices[quads].mean(axis=1)
    corners = np.stack([quads, np.roll(quads, -1, axis=1)], axis=2).reshape(-1, 2)
    keys = np.minimum(corners[:, 0], corners[:, 1]) * (vertex_count + 1) + np.maximum(corners[:, 0], corners[:, 1])
    unique_keys, first, edge_of_corner = np.unique(keys, return_index=True, return_inverse=True)
    edge_count = len(unique_keys)
    edges = np.sort(corners[first], axis=1)
    face_of_corner = np.repeat(np.arange(face_count), 4)
    faces_per_edge = np.bincount(edge_of_corner, minlength=edge_count)
    border = faces_per_edge == 1
    midpoints = vertices[edges].mean(axis=1)
    face_sum = np.zeros((edge_count, 3))
    np.add.at(face_sum, edge_of_corner, face_points[face_of_corner])
    edge_points = np.where(border[:, None], midpoints, (vertices[edges].sum(axis=1) + face_sum) / 4)

    valence = np.bincount(quads.reshape(-1), minlength=vertex_count)
    face_avg = np.zeros((vertex_count, 3))
    np.add.at(face_avg, quads.reshape(-1), np.repeat(face_points, 4, axis=0))
    face_avg /= np.maximum(valence, 1)[:, None]
    edge_valence = np.bincount(edges.reshape(-1), minlength=vertex_count)
    edge_avg = np.zeros((vertex_count, 3))
    np.add.at(edge_avg, edges.reshape(-1), np.repeat(midpoints, 2, axis=0))
    edge_avg /= np.maximum(edge_valence, 1)[:, None]
    n = valence[:, None]
    moved = (face_avg + 2 * edge_avg + (n - 3) * vertices) / np.maximum(n, 1)
    # Border vertices follow the border curve only.
    border_sum = np.zeros((vertex_count, 3))
    border_count = np.zeros(vertex_count)
    np.add.at(border_sum, edges[border].reshape(-1), np.repeat(midpoints[border], 2, axis=0))
    np.add.at(border_count, edges[border].reshape(-1), 1)
    on_border = border_count > 0
    moved[on_border] = 0.5 * vertices[on_border] + 0.5 * border_sum[on_border] / border_count[on_border, None]

    edge_index = vertex_count + edge_of_corner.reshape(-1, 4)
    face_index = vertex_count + edge_count + np.arange(face_count)
    new_quads = np.stack(
        [
            np.stack([quads[:, k], edge_index[:, k], face_index, edge_index[:, (k - 1) % 4]], axis=1)
            for k in range(4)
        ],
        axis=1,
    ).reshape(-1, 4)
    return np.vstack([moved, edge_points, face_points]), new_quads


def vertex_normals(vertices, quads):
    triangles = np.vstack([quads[:, [0, 1, 2]], quads[:, [0, 2, 3]]])
    face = np.cross(vertices[triangles[:, 1]] - vertices[triangles[:, 0]], vertices[triangles[:, 2]] - vertices[triangles[:, 0]])
    normals = np.zeros_like(vertices)
    for k in range(3):
        np.add.at(normals, triangles[:, k], face)
    normals /= np.linalg.norm(normals, axis=1)[:, None] + 1e-30
    # Outward: the top of the foot faces up.
    if normals[vertices[:, 1] > np.percentile(vertices[:, 1], 90), 1].mean() < 0:
        normals = -normals
    return normals


def register(skin, stocking, touching):
    """
    Scale and translation that put the MakeHuman leg (decimeters) onto the model (meters), found by matching it
    to the stocking vertices that lie on the skin of the foot.
    """
    foot_skin = skin[skin[:, 1] < skin[:, 1].min() + 1.1]
    foot = stocking[:, 1] < 0.1
    scale = 0.11
    shift = np.array(
        [
            stocking[foot, 0].min() - foot_skin[:, 0].min() * scale,
            stocking[:, 1].min() - skin[:, 1].min() * scale,
            stocking[foot, 2].max() - foot_skin[:, 2].max() * scale,
        ]
    )
    target = stocking[touching & (stocking[:, 1] < 0.07)]
    for _ in range(40):
        distance, nearest = cKDTree(skin * scale + shift).query(target)
        keep = distance < np.percentile(distance, 90)
        a, b = skin[nearest[keep]], target[keep]
        a0, b0 = a.mean(axis=0), b.mean(axis=0)
        scale = ((a - a0) * (b - b0)).sum() / ((a - a0) ** 2).sum()
        shift = b0 - scale * a0
    return scale, shift


# ---------------------------------------------------------------------------------------------------------------
# The skin
# ---------------------------------------------------------------------------------------------------------------

# The forefoot mesh is the part of the foot in front of FORE_Z and below FORE_Y (meters).
FORE_Z = 0.07
FORE_Y = 0.09
# Skin is shaded as lying between two toes when the next toe is nearer than SHADE_FAR, fully at SHADE_NEAR.
SHADE_NEAR = 0.0015
SHADE_FAR = 0.008


def smoothstep(edge0, edge1, x):
    t = np.clip((x - edge0) / (edge1 - edge0), 0, 1)
    return t * t * (3 - 2 * t)


def distance_to_path(points, path):
    """Distance from each point to a polyline, whose last segment is extended past its end."""
    best = np.full(len(points), np.inf)
    for i in range(len(path) - 1):
        a, b = path[i], path[i + 1]
        t = (points - a) @ (b - a) / ((b - a) @ (b - a))
        t = np.clip(t, 0, np.inf if i == len(path) - 2 else 1)
        best = np.minimum(best, np.linalg.norm(points - (a + t[:, None] * (b - a)), axis=1))
    return best


def between_toes(points, normals, toes):
    """How deep each skin point lies between two toes, 0 to 1: 1 where the next toe is right there."""
    # Which toe a point belongs to: the nearest one seen from above, measured in toe widths so that the side of
    # a wide toe is not taken for its narrower neighbour's.
    distance = np.array([distance_to_path(points[:, [0, 2]], toe[:, [0, 2]]) for toe in toes])
    nearest = np.argmin(distance, axis=0)
    sides = (np.abs(normals[:, 1]) < 0.3) & (points[:, 2] > min(toe[1, 2] for toe in toes))
    width = np.array([np.median(distance[k, sides & (nearest == k)]) for k in range(len(toes))])
    toe_of = np.argmin(distance / width[:, None], axis=0)
    # Only the free part of each toe shades its neighbours, not the foot they all grow from.
    free = points[:, 2] > np.array([toe[1, 2] for toe in toes])[toe_of] - 0.004
    nearest_other = np.full(len(points), np.inf)
    for k in range(len(toes)):
        others = toe_of != k
        own = free & (toe_of == k)
        if others.any() and own.any():
            found, _ = cKDTree(points[own]).query(points[others])
            nearest_other[others] = np.minimum(nearest_other[others], found)
    return 1 - smoothstep(SHADE_NEAR, SHADE_FAR, nearest_other)


# The quads of each toenail's plate in the MakeHuman lower leg (as load_makehuman_leg numbers them), big toe first.
NAIL_QUADS = [
    [789, 562, 646, 565, 566, 54, 720, 46, 788, 563],
    [274, 608, 414, 605, 604, 806],
    [663, 825, 822, 659, 660, 827],
    [451, 756, 847, 757, 758, 824],
    [1025, 985, 943, 986],
]
# The big toe's quads include the folds of skin along the nail's sides, which cover part of them.
NAIL_WIDTH = [0.9, 1, 1, 1, 1]


def nail_frames(points, normals, quads, levels, toes):
    """
    Each toenail as a frame on the skin: center, normal, forward (toward the tip) and half its width and length.
    points, normals, quads describe the skin after `levels` subdivisions; a quad's children stay together, so
    the plate of quad q is quads q * 4^levels onward.
    """
    frames = []
    for plate, toe, width in zip(NAIL_QUADS, toes, NAIL_WIDTH):
        children = np.concatenate([np.arange(q * 4**levels, (q + 1) * 4**levels) for q in plate])
        vertices = np.unique(quads[children])
        normal = normals[vertices].mean(axis=0)
        normal /= np.linalg.norm(normal)
        # Forward follows the toe's last bone, laid into the nail's plane.
        forward = toe[-1] - toe[-2]
        forward -= normal * (forward @ normal)
        forward /= np.linalg.norm(forward)
        across = np.cross(normal, forward)
        offset = points[vertices] - points[vertices].mean(axis=0)
        along = offset @ forward
        side = offset @ across
        center = points[vertices].mean(axis=0) + forward * (along.max() + along.min()) / 2 + across * (side.max() + side.min()) / 2
        frames.append(
            {
                "center": center,
                "normal": normal,
                "forward": forward,
                "half": np.array([width * (side.max() - side.min()) / 2, (along.max() - along.min()) / 2]),
            }
        )
    return frames


# ---------------------------------------------------------------------------------------------------------------
# The stocking over the skin
# ---------------------------------------------------------------------------------------------------------------

# The stocking is refitted in front of FABRIC_Z (fading in over that band) and below FABRIC_Y (fading out). The
# band starts in front of the plane where the app joins the forefoot to a bare leg (FOREFOOT_JOIN.cut), so the
# stocking keeps its smooth shape there, and ends about where the app's forefoot skin has left the stocking's
# surface for its own shape (FOREFOOT_JOIN.to), so the fabric is clear of the skin by then.
FABRIC_Z = (0.116, 0.132)
FABRIC_Y = (0.075, 0.090)
# The fabric's middle lies this far off the skin where it touches it.
FABRIC_THICKNESS = 0.0004
FABRIC_STEPS = 120


def fit_fabric(stocking, triangles, weld, skin, skin_normals):
    """
    The stocking around the toes as a membrane pulled taut over the skin: each round every vertex moves toward
    the middle of its neighbours (tension), then out of the skin if it sank in. What is left touches the skin on
    the toes' tops, tips and pads and spans the clefts between the toes and the creases under them.
    The membrane also stays outside the stocking's own shape as it was: that shape is the fabric at rest over
    the foot, so the fit only ever lifts it over the toes, and tension cannot draw it in behind them (which
    left a waist across the foot where the fit begins).
    Returns the new positions and each vertex's distance from the skin.
    """
    weight = smoothstep(*FABRIC_Z, stocking[:, 2]) * (1 - smoothstep(*FABRIC_Y, stocking[:, 1]))
    welded = weld[triangles]
    # Everything connected to a fitted vertex takes part; vertices outside the fit stay where they are.
    part = np.unique(welded[(weight[welded] > 0).any(axis=1)])
    slot = np.full(len(stocking), -1, dtype=np.int64)
    slot[part] = np.arange(len(part))
    faces = slot[welded]
    faces = faces[(faces >= 0).all(axis=1)]
    pairs = np.unique(np.sort(np.concatenate([faces[:, [0, 1]], faces[:, [1, 2]], faces[:, [2, 0]]]), axis=1), axis=0)
    pairs = np.concatenate([pairs, pairs[:, ::-1]])
    degree = np.bincount(pairs[:, 0], minlength=len(part))[:, None]
    free = weight[part] > 0
    tree = cKDTree(skin)

    def distance(points):
        _, nearest = tree.query(points)
        return np.einsum("ij,ij->i", points - skin[nearest], skin_normals[nearest]), nearest

    rest = stocking[part].copy()
    rest_normals = welded_normals(stocking, triangles, weld).astype(np.float64)[part]
    rest_tree = cKDTree(rest)
    position = stocking[part].copy()
    for _ in range(FABRIC_STEPS):
        total = np.zeros_like(position)
        np.add.at(total, pairs[:, 0], position[pairs[:, 1]])
        position[free] += 0.5 * (total[free] / degree[free] - position[free])
        _, at = rest_tree.query(position)
        inside = np.einsum("ij,ij->i", position - rest[at], rest_normals[at])
        drawn_in = free & (inside < 0)
        position[drawn_in] -= inside[drawn_in, None] * rest_normals[at[drawn_in]]
        off, nearest = distance(position)
        sunk = free & (off < FABRIC_THICKNESS)
        position[sunk] += (FABRIC_THICKNESS - off[sunk])[:, None] * skin_normals[nearest[sunk]]
    fitted = stocking.copy()
    fitted[part] = stocking[part] + (position - stocking[part]) * weight[part, None]
    fitted = fitted[weld]
    return fitted, np.maximum(distance(fitted)[0] - FABRIC_THICKNESS, 0), weight[weld] > 0


# ---------------------------------------------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------------------------------------------


def remove_mesh(glb, name):
    """Removes a mesh written by an earlier run, with its node and accessors (which must be the last ones)."""
    gltf = glb.gltf
    index = next((i for i, mesh in enumerate(gltf["meshes"]) if mesh.get("name") == name), None)
    if index is None:
        return
    primitive = gltf["meshes"][index]["primitives"][0]
    glb.drop_trailing_accessors(min([primitive["indices"], *primitive["attributes"].values()]))
    node = next(i for i, node in enumerate(gltf["nodes"]) if node.get("mesh") == index)
    if index != len(gltf["meshes"]) - 1 or node != len(gltf["nodes"]) - 1:
        raise SystemExit(f'cannot remove the "{name}" mesh: it is not the last one')
    del gltf["meshes"][index]
    del gltf["nodes"][node]
    for scene in gltf["scenes"]:
        scene["nodes"] = [n for n in scene["nodes"] if n != node]


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("makehuman", help="path to MakeHuman's base.obj")
    parser.add_argument("--model", default="src/assets/model/legs.glb")
    args = parser.parse_args()

    glb = Glb(args.model)
    remove_mesh(glb, "forefoot")
    mesh = next(mesh for mesh in glb.gltf["meshes"] if mesh.get("name") == "stocking")
    primitive = mesh["primitives"][0]
    base = glb.read(primitive["attributes"]["POSITION"])
    triangles = glb.read(primitive["indices"]).astype(np.int64).reshape(-1, 3)
    wrap_info = mesh["extras"]["wrapOffsets"]
    wrap = glb.read(wrap_info["accessor"]).copy()

    positions, triangles = subdivide_smooth(base, triangles)
    positions, triangles = subdivide_smooth(positions, triangles)
    if len(positions) != len(wrap):
        raise SystemExit("the wrap offsets do not belong to the twice-subdivided stocking mesh")
    stocking32 = positions + wrap[:, :3].astype(np.float32) * np.float32(WRAP_UNIT)
    weld = weld_vertices(stocking32)
    stocking = stocking32.astype(np.float64)
    gap = (wrap[:, 3] >> 4) * 2 * WRAP_UNIT

    # Place the MakeHuman leg on the model, matching it to the stocking where the stocking lies on the skin.
    cage, cage_quads, toes = load_makehuman_leg(args.makehuman)
    # The placement is found once and kept in the file: refitting the stocking below changes what it is found from.
    placement = glb.gltf.setdefault("extras", {}).get("makehumanPlacement")
    if placement:
        scale, shift = placement["scale"], np.array(placement["shift"])
    else:
        scale, shift = register(catmull_clark(*catmull_clark(cage, cage_quads))[0], stocking, gap == 0)
        scale, shift = round(float(scale), 6), np.round(shift, 6)
        glb.gltf["extras"]["makehumanPlacement"] = {
            "scale": scale,
            "shift": shift.tolist(),
            "description": "MakeHuman base mesh (decimeters) to this model (meters): position * scale + shift.",
        }
    cage = cage * scale + shift
    toes = [toe * scale + shift for toe in toes]
    print(f"MakeHuman leg placed at scale {scale:.5f} m/dm, shift {np.round(shift, 5)}")

    # The skin's surface, for the nails and the shade between the toes.
    skin, skin_quads = cage, cage_quads
    for _ in range(3):
        skin, skin_quads = catmull_clark(skin, skin_quads)
    skin_normals = vertex_normals(skin, skin_quads)
    frames = nail_frames(skin, skin_normals, skin_quads, 3, toes)
    # Subdividing keeps the cage's vertices first, each moved onto the surface.
    shade = between_toes(skin, skin_normals, toes)[: len(cage)]

    # Refit the stocking over the toes. The fit starts from the stocking as it is, so it is done once; to redo
    # it, start again from the model as it was before.
    if wrap_info.get("toesFitted"):
        print("the stocking is already fitted over the toes")
    else:
        fitted, off, changed = fit_fabric(stocking, triangles, weld, skin, skin_normals)
        moved = np.linalg.norm(fitted - stocking, axis=1)
        print(f"stocking refitted over the toes: {int(changed.sum())} vertices, moved up to {moved.max() * 1000:.1f} mm")
        offsets = np.rint((fitted - positions.astype(np.float64)) / WRAP_UNIT)
        packed_gap = np.minimum(np.rint(off / (2 * WRAP_UNIT)), 4095).astype(np.int64)
        wrap[changed, :3] = offsets[changed]
        wrap[changed, 3] = ((packed_gap[changed] << 4) | (wrap[changed, 3] & 15)).astype(np.uint16).view(np.int16)
        glb.replace(wrap_info["accessor"], wrap)
        wrap_info["toesFitted"] = True

    in_front = (cage[cage_quads][:, :, 2] > FORE_Z).all(axis=1) & (cage[cage_quads][:, :, 1] < FORE_Y).all(axis=1)
    used = np.unique(cage_quads[in_front])
    remap = np.full(len(cage), -1, dtype=np.int64)
    remap[used] = np.arange(len(used))
    fore = cage[used].astype(np.float32)
    quads = remap[cage_quads[in_front]]
    # Two triangles per quad, a b c and a c d, so readers can put the quads back together.
    fore_triangles = quads[:, [0, 1, 2, 0, 2, 3]].reshape(-1)

    position = glb.append("forefoot.position", fore, 5126, "VEC3")
    glb.gltf["accessors"][position].update(min=fore.min(axis=0).tolist(), max=fore.max(axis=0).tolist())
    glb.gltf["bufferViews"][-1]["target"] = 34962
    shade_accessor = glb.append("forefoot.shade", np.rint(shade[used] * 255), 5121, "SCALAR", normalized=True)
    glb.gltf["bufferViews"][-1]["target"] = 34962
    indices = glb.append("forefoot.indices", fore_triangles, 5123, "SCALAR")
    glb.gltf["bufferViews"][-1]["target"] = 34963
    glb.gltf["meshes"].append(
        {
            "name": "forefoot",
            "primitives": [{"attributes": {"POSITION": position, "_SHADE": shade_accessor}, "indices": indices, "mode": 4}],
            "extras": {
                "description": (
                    "The skin of the forefoot with its separate toes, from the MakeHuman base mesh, as a control "
                    "cage for Catmull-Clark subdivision: every two triangles (a b c, a c d) are one quad. _SHADE: "
                    "how deep the vertex lies between two toes. nails: the toenails as frames on the skin (meters), "
                    "big toe first; half is half the nail's width and length. Written by tools/fit_toes.py."
                ),
                "nails": [
                    {key: [round(float(value), 5) for value in frame[key]] for key in ("center", "normal", "forward", "half")}
                    for frame in frames
                ],
            },
        }
    )
    glb.gltf["nodes"].append({"name": "forefoot", "mesh": len(glb.gltf["meshes"]) - 1})
    for scene in glb.gltf["scenes"]:
        scene["nodes"].append(len(glb.gltf["nodes"]) - 1)
    glb.write(args.model)
    print(f"forefoot: {len(fore)} vertices, {len(quads)} quads")
    for frame in glb.gltf["meshes"][-1]["extras"]["nails"]:
        print("  nail", frame)


if __name__ == "__main__":
    sys.exit(main())

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
from scipy.interpolate import RegularGridInterpolator, griddata
from scipy.ndimage import gaussian_filter, grey_closing, minimum_filter1d
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
# band is the one over which the app's forefoot skin leaves the stocking's surface for its own shape (from just
# in front of FOREFOOT_JOIN.cut to FOREFOOT_JOIN.to), so the fabric and the skin go over together.
FABRIC_Z = (0.113, 0.130)
FABRIC_Y = (0.075, 0.090)
# The fabric's middle lies this far off the skin where it touches it.
FABRIC_THICKNESS = 0.00015
FABRIC_STEPS = 800
# The toes keep their own shape, and the foot behind them is laid just inside the stocking (see onto_stocking).
# A toe begins FABRIC_TOE_ROOT behind where it comes free of the foot (further back under the foot by
# FABRIC_TOE_CREASE, to take in the crease behind its pad), and the one goes over to the other over
# FABRIC_TOE_FADE behind that.
FABRIC_TOE_ROOT = 0.004
FABRIC_TOE_CREASE = 0.003
FABRIC_TOE_FADE = 0.008
# How far the fabric is pressed toward the skin on top of the foot each step (m, where the mesh's edges are 1 mm
# long): the more, the deeper it sags into the hollows it spans. Over the toes it is that times
# FABRIC_PRESSURE_TOES.
FABRIC_PRESSURE_TOES = 0.25
FABRIC_PRESSURE = 0.000005
# The skin between the join and the toes is smoothed (see smooth_foot): in front of SMOOTH_Z, fading in over
# that band, this many rounds.
SMOOTH_Z = (0.100, 0.118)
# ...and up to the clefts between the toes (see cleft_line): it fades out over this range before them.
SMOOTH_TOES = (-0.010, -0.003)
SMOOTH_ROUNDS = 10
# Dents across the foot are filled (see dents_across) in front of FILL_Z on top (key 1) and under the foot (key
# -1, from the balls on: the arch behind them is hollow as it should be), fading in over those bands, and up to
# the clefts between the toes: it fades out over FILL_TOES before them (earlier under the foot, where the
# crease behind the toes' pads lies), slowly, so the valleys that run into the clefts stay and nothing bulges
# behind them. The filling is blurred by FILL_BLUR.
FILL_Z = {1: (0.055, 0.075), -1: (0.092, 0.105)}
FILL_TOES = {1: (-0.024, -0.006), -1: (-0.032, -0.014)}
FILL_BLUR = 0.0015
# Lumps are taken out of the same parts of the foot (see lumps): those up to about twice SMOOTH_BLUR across.
SMOOTH_BLUR = 0.004
SMOOTH_TOES_AT = {1: (-0.016, -0.004), -1: (-0.024, -0.012)}
# The sole and the foot's sides are smoothed (see smooth_sole) in front of SOLE_Z and below SOLE_Y, fading in
# over those bands.
SOLE_Z = (0.065, 0.080)
SOLE_Y = (0.035, 0.050)
SOLE_BLUR = 0.005
SOLE_ROUNDS = 3
# Dents in the foot's sides are filled (see side_dents) in front of SIDE_Z, fading in over that band, and up to
# SIDE_TOES before the clefts, which leaves the ball of the big toe as it is.
SIDE_Z = (0.085, 0.100)
SIDE_TOES = (-0.012, -0.002)
SIDE_BLUR = 0.008
SIDE_ROUNDS = 3
# The skin lies just inside the stocking at the join (see onto_stocking) and has left it this far before the
# clefts: on top, and under the foot and on its sides.
ONTO_TOES = (-0.006, -0.018)
# A cleft between two toes begins where the skin lies CLEFT_DEPTH under a line laid across CLEFT_WIDTH of the
# foot's top, in front of CLEFT_FROM; the toes' roots up to CLEFT_BESIDE to its sides count as being at it.
CLEFT_DEPTH = 0.002
CLEFT_WIDTH = 0.014
CLEFT_FROM = 0.125
CLEFT_BESIDE = 0.008


def over_toes(points, normals, toes):
    """How much each point is over a toe, 0 to 1 (see FABRIC_TOE_ROOT)."""
    toe_of = np.argmin([distance_to_path(points[:, [0, 2]], toe[:, [0, 2]]) for toe in toes], axis=0)
    begins = np.array([toe[1, 2] for toe in toes])[toe_of] - FABRIC_TOE_ROOT
    begins -= FABRIC_TOE_CREASE * smoothstep(-0.2, 0.3, -normals[:, 1])
    return smoothstep(begins - FABRIC_TOE_FADE, begins, points[:, 2])


def foot_height(points, normals, sign):
    """
    The foot's top (sign 1) or sole (sign -1) as a height field over a 1 mm grid: sign * y where the surface
    faces up (or down). Returns the grid's xs and zs, the heights (NaN outside the foot) and how much each
    point faces that way (0 to 1).
    """
    cell = 0.001
    facing = smoothstep(0.2, 0.6, sign * normals[:, 1])
    used = (facing > 0) & (points[:, 2] > 0.03) & (points[:, 1] < 0.13)
    xs = np.arange(points[used, 0].min(), points[used, 0].max() + cell, cell)
    zs = np.arange(points[used, 2].min(), points[used, 2].max() + cell, cell)
    height = griddata(points[used][:, [0, 2]], sign * points[used, 1], tuple(np.meshgrid(xs, zs)), method="linear")
    return xs, zs, height, facing


def cleft_line(points, normals, toes):
    """
    Where the clefts between the toes begin, as z per x (two arrays): seen from above, the first place along
    the foot where the skin lies CLEFT_DEPTH under a line laid across its neighbourhood (a closing of the top's
    height field over CLEFT_WIDTH). Beside a cleft the toes' own roots count as being at it, and the line is
    smoothed across the foot.
    """
    xs, zs, height, _ = foot_height(points, normals, 1)
    have = np.isfinite(height)
    low = np.where(have, height, np.nanmin(height))
    depth = np.where(have, grey_closing(low, size=(1, int(CLEFT_WIDTH / 0.001) | 1)) - low, 0)
    depth[zs < CLEFT_FROM] = 0
    begins = np.array([zs[column.argmax()] if column.any() else np.nan for column in (depth > CLEFT_DEPTH).T])
    # Only between the big toe and the little one: beyond them a notch in the foot's outline is no cleft.
    between = (xs >= min(toe[1, 0] for toe in toes)) & (xs <= max(toe[1, 0] for toe in toes))
    found = np.isfinite(begins) & between
    begins = np.interp(xs, xs[found], begins[found])
    begins = minimum_filter1d(begins, int(CLEFT_BESIDE / 0.001) | 1, mode="nearest")
    return xs, gaussian_filter(begins, CLEFT_BESIDE / 0.002, mode="nearest")


def before_toes(points, clefts, begin, end):
    """
    1 between the z band `begin` (fading in) and the clefts (fading out over `end`, relative to where the cleft
    nearest across the foot begins, see cleft_line).
    """
    at = np.interp(points[:, 0], *clefts)
    return smoothstep(*begin, points[:, 2]) * (1 - smoothstep(at + end[0], at + end[1], points[:, 2]))


def lumps(points, normals, clefts, sign):
    """
    How far each point of the foot's top (sign 1) or sole (sign -1) lies above the same surface with its lumps
    of up to about a centimeter taken out (m, signed along sign * y). The surface is blurred twice over
    (2 G - G G), which leaves its broad roundness as it is, so the foot keeps its size.
    """
    xs, zs, height, facing = foot_height(points, normals, sign)
    have = np.isfinite(height)
    filled = np.where(have, height, 0)
    cells = SMOOTH_BLUR / 0.001

    def blur(field):
        return gaussian_filter(field * have, cells) / np.maximum(gaussian_filter(have.astype(float), cells), 1e-6)

    once = blur(filled)
    smooth = 2 * once - blur(once)
    excess = np.where(have, filled - smooth, 0)
    at = RegularGridInterpolator((zs, xs), excess, bounds_error=False, fill_value=0)(points[:, [2, 0]])
    return at * facing * before_toes(points, clefts, FILL_Z[sign], SMOOTH_TOES_AT[sign])


def dents_across(points, normals, clefts, sign):
    """
    How far each point of the foot's top (sign 1) or sole (sign -1) lies inside the foot's outline across it:
    the foot is cut into slices across, and each slice's top (or sole) outline is compared with its convex
    hull. A foot that is rounded across has none of it; a dent that runs along the foot does. Only between
    FILL_Z (per side) and the toes, and only where the surface faces up (or down).
    Returns the depth per point (m, 0 or more).
    """
    cell = 0.001
    xs, zs, height, facing = foot_height(points, normals, sign)
    depth = np.zeros_like(height)
    for row in range(len(zs)):
        have = np.isfinite(height[row])
        if have.sum() < 3:
            continue
        px, py = xs[have], height[row, have]
        hull = []
        for x, y in zip(px, py):
            while len(hull) >= 2 and (hull[-1][0] - hull[-2][0]) * (y - hull[-2][1]) >= (hull[-1][1] - hull[-2][1]) * (x - hull[-2][0]):
                hull.pop()
            hull.append((x, y))
        hull = np.array(hull)
        depth[row, have] = np.interp(px, hull[:, 0], hull[:, 1]) - py
    depth = gaussian_filter(depth, FILL_BLUR / cell)
    at = RegularGridInterpolator((zs, xs), depth, bounds_error=False, fill_value=0)(points[:, [2, 0]])
    return np.maximum(at, 0) * facing * before_toes(points, clefts, FILL_Z[sign], FILL_TOES[sign])


def smooth_sole(stocking, triangles, weld, clefts):
    """
    The stocking with the small ridges and grooves taken out of the sole and the foot's sides, from behind the
    balls to the clefts: along the inner edge of the sole a ridge with a groove beside it read as a dent.
    Each vertex is compared, along its normal, with the surface around it blurred twice over (2 G - G G at
    SOLE_BLUR, which leaves the arch and the balls as they are) and moved onto it.
    """
    points = stocking.copy()
    canonical = np.unique(weld)
    part = canonical[(points[canonical, 2] > 0.04) & (points[canonical, 2] < 0.19) & (points[canonical, 1] < 0.08)]
    for _ in range(SOLE_ROUNDS):
        normals = welded_normals(points, triangles, weld).astype(np.float64)[part]
        at = points[part]
        near = cKDTree(at).query_ball_point(at, 3 * SOLE_BLUR)

        def blur(field):
            out = np.empty_like(field)
            for i, others in enumerate(near):
                others = np.array(others)
                others = others[normals[others] @ normals[i] > 0.5]
                share = np.exp(-((at[others] - at[i]) ** 2).sum(axis=1) / (2 * SOLE_BLUR**2))
                out[i] = share @ field[others] / share.sum()
            return out

        once = blur(at)
        lump = np.einsum("ij,ij->i", at - (2 * once - blur(once)), normals)
        amount = before_toes(at, clefts, SOLE_Z, SMOOTH_TOES_AT[-1])
        amount = amount * (1 - smoothstep(0.0, 0.4, normals[:, 1])) * (1 - smoothstep(*SOLE_Y, at[:, 1]))
        points[part] = at - (lump * amount)[:, None] * normals
        points = points[weld]
    return points


def side_dents(points, normals, clefts):
    """
    How deep each point of the foot's sides lies in a dent, behind the balls: along its normal, under the
    surface around it blurred twice over (2 G - G G at SIDE_BLUR, so dents of up to a few centimeters count
    and the foot's own roundness does not). Behind the ball of the big toe the inner side of the foot dipped.
    Returns the depth per point (m, 0 or more).
    """
    part = np.where((points[:, 2] > 0.06) & (points[:, 2] < 0.18) & (points[:, 1] < 0.075))[0]
    at, facing = points[part], normals[part]
    near = cKDTree(at).query_ball_point(at, 3 * SIDE_BLUR)

    def blur(field):
        out = np.empty_like(field)
        for i, others in enumerate(near):
            others = np.array(others)
            others = others[facing[others] @ facing[i] > 0.5]
            share = np.exp(-((at[others] - at[i]) ** 2).sum(axis=1) / (2 * SIDE_BLUR**2))
            out[i] = share @ field[others] / share.sum()
        return out

    once = blur(at)
    lump = np.einsum("ij,ij->i", at - (2 * once - blur(once)), facing)
    amount = before_toes(at, clefts, SIDE_Z, SIDE_TOES) * (1 - smoothstep(*SOLE_Y, at[:, 1]))
    amount = amount * smoothstep(0.3, 0.55, np.abs(facing[:, 0])) * (1 - smoothstep(0.3, 0.7, facing[:, 1]))
    depth = np.zeros(len(points))
    depth[part] = np.maximum(-lump, 0) * amount
    return depth


def fill_sides(cage, cage_quads, clefts):
    """The skin's cage with the dents in the foot's sides filled (see side_dents), measured on its surface."""
    # The cage is coarse, so each round moves it a little further than the surface is short.
    for _ in range(SIDE_ROUNDS * 3):
        surface, quads = cage, cage_quads
        for _ in range(2):
            surface, quads = catmull_clark(surface, quads)
        normals = vertex_normals(surface, quads)
        cage = cage + 1.4 * (side_dents(surface, normals, clefts)[:, None] * normals)[: len(cage)]
    return cage


def fill_foot(cage, cage_quads, clefts):
    """
    The skin's cage with its lumps taken out (see lumps) and the dents across the foot filled (see
    dents_across), on top and under the balls: the MakeHuman foot dips between the big toe's side and the outer
    side, which reads as a groove along the foot. It is the skin's surface that is measured, and the cage's
    vertices that are moved.
    """
    for measure in (lumps, lumps, lumps, dents_across, dents_across, dents_across, dents_across):
        surface, quads = cage, cage_quads
        for _ in range(3):
            surface, quads = catmull_clark(surface, quads)
        normals = vertex_normals(surface, quads)
        for sign in (1, -1):
            move = measure(surface, normals, clefts, sign)[: len(cage)]
            cage = cage + np.array([0, sign if measure is dents_across else -sign, 0]) * move[:, None]
    return cage


def smooth_foot(cage, cage_quads, clefts):
    """
    The skin's cage with the foot between the join and the toes smoothed: the MakeHuman foot has dents between
    the balls and between the tendons on top that read as lumps on a smoothly shaded foot. Each round moves
    every vertex toward the middle of its neighbours and then a little further back out (Taubin smoothing), so
    the dents go and the foot keeps its size. The toes and the clefts between them are left alone.
    """
    edges = np.concatenate([cage_quads[:, [k, (k + 1) % 4]] for k in range(4)])
    edges = np.concatenate([edges, edges[:, ::-1]])
    degree = np.maximum(np.bincount(edges[:, 0], minlength=len(cage)), 1)[:, None]
    amount = before_toes(cage, clefts, SMOOTH_Z, SMOOTH_TOES) * (1 - smoothstep(*FABRIC_Y, cage[:, 1]))
    for _ in range(SMOOTH_ROUNDS):
        for step in (0.5, -0.52):
            total = np.zeros_like(cage)
            np.add.at(total, edges[:, 0], cage[edges[:, 1]])
            cage = cage + (step * amount)[:, None] * (total / degree - cage)
    return cage


def onto_stocking(cage, cage_quads, stocking, stocking_normals, clefts):
    """
    The skin's cage laid just inside the stocking at the join, leaving it gradually on the way to the clefts
    between the toes (sooner under the foot, where the balls keep their own shape). The stocking was made for
    a slightly fuller foot than the MakeHuman one and is smoothed behind the toes, so the skin stepped where
    the app lays it onto the stocking, in front of the join. The toes keep their own shape (the fabric is
    fitted to them instead).
    It is the skin's surface that is laid there, not the cage: each round moves the cage's vertices by what
    their points of the subdivided surface are still short of, evened out over their neighbours so that the
    skin stays as smooth as it was.
    """
    tree = cKDTree(stocking)
    start = cage
    edges = np.concatenate([cage_quads[:, [k, (k + 1) % 4]] for k in range(4)])
    edges = np.concatenate([edges, edges[:, ::-1]])
    degree = np.maximum(np.bincount(edges[:, 0], minlength=len(cage)), 1)[:, None]
    for _ in range(8):
        surface, quads = cage, cage_quads
        for _ in range(3):
            surface, quads = catmull_clark(surface, quads)
        # Subdividing keeps the cage's vertices first, each moved onto the surface.
        points = surface[: len(cage)]
        apart, nearest = tree.query(points)
        normals = stocking_normals[nearest]
        outside = np.einsum("ij,ij->i", points - stocking[nearest], normals)
        # On top the skin has left the stocking by ONTO_TOES[0] before the clefts, under the foot and on its
        # sides by ONTO_TOES[1], before the balls.
        on_top = smoothstep(-0.1, 0.5, normals[:, 1])
        leaves = np.interp(start[:, 0], *clefts) + ONTO_TOES[1] + (ONTO_TOES[0] - ONTO_TOES[1]) * on_top
        follow = 1 - smoothstep(FABRIC_Z[0], np.maximum(leaves, FABRIC_Z[1]), start[:, 2])
        follow = follow * (apart < 0.008) * (start[:, 1] < FABRIC_Y[1])
        move = -((outside + FABRIC_THICKNESS) * follow)[:, None] * normals
        for _ in range(2):
            total = np.zeros_like(move)
            np.add.at(total, edges[:, 0], move[edges[:, 1]])
            move = 0.5 * move + 0.5 * total / degree
        cage = cage + move
    return cage


def fit_fabric(stocking, triangles, weld, skin, skin_normals, toes):
    """
    The stocking around the toes as a membrane pulled taut over the skin: each round every vertex moves toward
    the middle of its neighbours across the membrane (tension), is pressed toward the skin on top of the foot
    (see FABRIC_PRESSURE), then moves out of the skin if it sank in. What is left lies on the skin where the
    foot is rounded out (the toes' tops, tips and pads, the balls, the top of the foot) and spans its hollows:
    the clefts between the toes, the creases under them, the dents along a toe.
    The stocking's toe was roomier than the toes are, so the membrane draws in a good deal; the skin behind
    the toes lies just inside the stocking as it was (see onto_stocking), so there it stays where it was.
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

    def normals_of(points):
        corners = points[faces]
        face = np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0])
        total = np.zeros_like(points)
        for k in range(3):
            np.add.at(total, faces[:, k], face)
        return total / np.maximum(np.linalg.norm(total, axis=1, keepdims=True), 1e-12)

    rest = stocking[part].copy()
    rest_normals = welded_normals(stocking, triangles, weld).astype(np.float64)[part]
    # The membrane may draw in wherever the skin has a shape of its own: over the toes and where the foot
    # goes over to them.
    over = over_toes(rest, rest_normals, toes)
    # The knit's own stretch around the foot presses it onto the top of the foot, like a slight vacuum under
    # it, so it follows the skin down to the toes instead of spanning from the instep to their knuckles. Under
    # the foot and around the toes it is left taut, and spans the hollows between the balls and the toes.
    pressure = FABRIC_PRESSURE * smoothstep(0.2, 0.7, rest_normals[:, 1])
    pressure *= 1 - (1 - FABRIC_PRESSURE_TOES) * smoothstep(0.5, 1, over)
    # Tension is a move toward the neighbours' middle, which is weaker the finer the mesh is: the pressure that
    # balances it goes by the square of the distance to them, so the sag does not depend on the mesh.
    reach = np.zeros(len(rest))
    np.add.at(reach, pairs[:, 0], np.linalg.norm(rest[pairs[:, 1]] - rest[pairs[:, 0]], axis=1))
    pressure *= (reach / degree[:, 0] / 0.001) ** 2
    print(f"fabric mesh around the toes: edges {np.percentile(reach / degree[:, 0], [5, 50, 95]).round(5)} m")
    position = stocking[part].copy()
    for _ in range(FABRIC_STEPS):
        total = np.zeros_like(position)
        np.add.at(total, pairs[:, 0], position[pairs[:, 1]])
        # Tension acts across the membrane. Along it the knit keeps its lay: there each vertex only follows its
        # neighbours' move from where they were, or the stitches would bunch up in the hollows.
        along = normals_of(position)
        pull = total / degree - position
        np.add.at(total, pairs[:, 0], -rest[pairs[:, 1]])
        drift = total / degree - (position - rest)
        across = np.einsum("ij,ij->i", pull, along)[:, None] * along
        slide = drift - np.einsum("ij,ij->i", drift, along)[:, None] * along
        position[free] += 0.5 * (across + slide)[free]
        position[free] -= (pressure[:, None] * along)[free]
        off, nearest = distance(position)
        sunk = free & (off < FABRIC_THICKNESS)
        position[sunk] += (FABRIC_THICKNESS - off[sunk])[:, None] * skin_normals[nearest[sunk]]
    fitted = stocking.copy()
    fitted[part] = stocking[part] + (position - stocking[part]) * weight[part, None]
    fitted = fitted[weld]
    # Tension must not have folded the membrane over itself.
    corners = fitted[triangles]
    before = stocking[triangles]
    turned = np.einsum(
        "ij,ij->i",
        np.cross(corners[:, 1] - corners[:, 0], corners[:, 2] - corners[:, 0]),
        np.cross(before[:, 1] - before[:, 0], before[:, 2] - before[:, 0]),
    )
    if (turned < 0).any():
        raise SystemExit(f"the fitted stocking folds over itself in {int((turned < 0).sum())} triangles")
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
    # Where the clefts between the toes begin: everything done to the foot behind them stops short of there.
    surface, surface_quads = cage, cage_quads
    for _ in range(3):
        surface, surface_quads = catmull_clark(surface, surface_quads)
    clefts = cleft_line(surface, vertex_normals(surface, surface_quads), toes)
    print("clefts begin at z (mm) for x -50 to 50 mm:", np.interp(np.arange(-0.05, 0.051, 0.01), *clefts).round(3) * 1000)
    # The foot behind the toes without its dents: the stocking's own shape there, and the skin's.
    filled = stocking.copy()
    stocking_normals = welded_normals(stocking, triangles, weld).astype(np.float64)
    for sign in (1, -1):
        filled[:, 1] -= sign * lumps(stocking, stocking_normals, clefts, sign)
    filled = filled[weld]
    for sign in (1, -1):
        filled[:, 1] += sign * dents_across(filled, welded_normals(filled, triangles, weld).astype(np.float64), clefts, sign)
    filled = filled[weld]
    print(f"stocking: lumps taken out and dents across the foot filled, by up to {np.abs(filled - stocking).max() * 1000:.2f} mm")
    stocking = smooth_sole(filled, triangles, weld, clefts)
    print(f"stocking: sole smoothed, by up to {np.abs(stocking - filled).max() * 1000:.2f} mm")
    canonical = np.unique(weld)
    for _ in range(SIDE_ROUNDS):
        normals = welded_normals(stocking, triangles, weld).astype(np.float64)
        stocking[canonical] += (side_dents(stocking[canonical], normals[canonical], clefts)[:, None] * normals[canonical])
        stocking = stocking[weld]
    cage = smooth_foot(cage, cage_quads, clefts)
    cage = fill_foot(cage, cage_quads, clefts)
    cage = fill_sides(cage, cage_quads, clefts)
    cage = onto_stocking(cage, cage_quads, stocking, welded_normals(stocking, triangles, weld).astype(np.float64), clefts)
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
        fitted, off, changed = fit_fabric(stocking, triangles, weld, skin, skin_normals, toes)
        moved = np.linalg.norm(fitted - stocking, axis=1)
        print(f"stocking refitted over the toes: {int(changed.sum())} vertices, moved up to {moved.max() * 1000:.1f} mm")
        offsets = np.rint((fitted - positions.astype(np.float64)) / WRAP_UNIT)
        packed_gap = np.minimum(np.rint(off / (2 * WRAP_UNIT)), 4095).astype(np.int64)
        # Behind the fit the stocking only moved where a dent was filled; its distance to the skin stays.
        filled_only = ~changed & (np.linalg.norm(fitted - stocking32, axis=1) > WRAP_UNIT / 2)
        wrap[filled_only, :3] = offsets[filled_only]
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

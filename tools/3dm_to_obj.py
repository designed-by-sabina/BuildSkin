"""Convert Rhino .3dm massings to .obj for BuildSkin.

Usage:  pip install rhino3dm
        python tools/3dm_to_obj.py "Sample Massing/Townhouse.3dm" ...

Uses the render meshes saved in the .3dm (Rhino saves these by default; if a
file has none, open it in Rhino, shade the view and save again). Writes the
.obj next to the .3dm, in the file's own units, converted to Y-up
(Rhino +Y becomes OBJ -Z, so north stays north in the calculator).
"""
import sys
from pathlib import Path

import rhino3dm as r


def object_mesh(geom):
    if isinstance(geom, r.Mesh):
        return geom
    if isinstance(geom, r.Extrusion):
        return geom.GetMesh(r.MeshType.Any)
    if isinstance(geom, r.Brep):
        joined = r.Mesh()
        for i in range(len(geom.Faces)):
            m = geom.Faces[i].GetMesh(r.MeshType.Any)
            if m is None:
                return None
            joined.Append(m)
        return joined
    return None


def convert(path):
    model = r.File3dm.Read(str(path))
    if model is None:
        raise SystemExit(f"Could not read {path}")
    lines = [f"# from {path.name}, units: {model.Settings.ModelUnitSystem}, Y-up"]
    base = 1
    skipped = 0
    for n, obj in enumerate(model.Objects):
        mesh = object_mesh(obj.Geometry)
        if mesh is None:
            skipped += 1
            continue
        lines.append(f"o {obj.Attributes.Name or f'object_{n}'}")
        verts = mesh.Vertices
        for i in range(len(verts)):
            v = verts[i]
            lines.append(f"v {v.X:.6f} {v.Z:.6f} {-v.Y:.6f}")
        for i in range(len(mesh.Faces)):
            a, b, c, d = mesh.Faces[i]
            idx = [a, b, c] if c == d else [a, b, c, d]
            lines.append("f " + " ".join(str(base + k) for k in idx))
        base += len(verts)
    out = path.with_suffix(".obj")
    out.write_text("\n".join(lines) + "\n")
    print(f"{path.name} -> {out.name} ({base - 1} vertices, {skipped} objects without a mesh skipped)")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        raise SystemExit(__doc__)
    for p in sys.argv[1:]:
        convert(Path(p))

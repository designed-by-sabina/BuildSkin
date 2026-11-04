# BuildSkin

BuildSkin tests schematic facade designs. You apply wall assemblies to surfaces of a building massing in 3D, and BuildSkin reports physical properties (thermal performance, shading, transparency) area-weighted across the facade, checked against LEED v4.1 and WELL targets. Results are assembly data × the area each assembly covers. Environmental impact (embodied carbon) and economic feasibility (labor/material cost) have places in the data model but are not calculated yet.

The aim is an assembly vocabulary that encourages envelope solutions that are both distinctive and efficient.

## Pages

| Page | File | Status |
| --- | --- | --- |
| 01 Cover | `index.html` | Blank placeholder, to be designed |
| 02 Massing | `massing.html` | Pick a sample massing or upload `.obj` files; set units / up-axis |
| 03 Calculator | `calculator.html` | Assembly library + 3D massing + RESULTS / LAYERS / TARGETS |

## Run locally

ES modules don't load from `file://`, so serve the folder:

```
python -m http.server 8765
```

then open http://localhost:8765. GitHub Pages works as-is (no build step; Three.js loads from a CDN).

## Data

### Assemblies: `data/assemblies.json`

The library currently has one assembly, from `Wall Assemblies/`: Revit **Basic Wall: Exterior - Brick on Mtl. Stud** (1'-1 7/8").

- Layers are stored exterior → interior with thickness, k, cp, density and emissivity, plus a note on where each value came from. Values with no source are `null` and marked TODO. Nothing is estimated.
- **The Revit R-54.02 (IFC U 0.105 W/m²K) is not usable for compliance.** The Revit material "Metal Stud Layer" has a steel physical asset but an **Air** thermal asset (k 0.0144). So Revit counts the 6" stud layer as about R-35 of still air, ignores the steel studs (no thermal bridging), and treats the 3" air gap as still-air conduction (about R-17). There is no insulation layer. The calculator marks this U with ⚠ until `effective.u_value` is filled from ASHRAE 90.1 Appendix A or thermalenvelope.ca.
- `cost` and `embodied_carbon` are placeholders only.
- `pattern` is for display only (modular brick running bond assumed).

Source priority: codes, standards and manufacturer data first (IECC 2024, IBC 2027 ch. 13–14, ASHRAE 90.1 / AEDG, USGBC LEED v4.1, WELL, thermalenvelope.ca). Use book tables (Allen & Rand, *Architectural Detailing* 3rd ed.) only when nothing else has the data, and cite book and table.

### Targets: `data/targets.json`

- **LEED v4.1 Optimize Energy Performance, envelope options.** The calculator computes walls-only UA (Σ U × A) against a baseline wall U. Choose a climate zone and enter the baseline U by hand until the ASHRAE 90.1-2016 table values are added. The option structure (25% / 50% UA, SHGC, infiltration) still needs checking against the USGBC rating system.
- **WELL: thermal comfort, daylight, views.** Listed with thresholds where known. None can be computed from envelope data alone yet.

### Massings: `Sample Massing/`

- `Townhouse` and `Apartment building (Fulton Houses)`: Rhino `.3dm` originals, converted to `.obj`, listed in `Sample Massing/manifest.json`.
- To convert another `.3dm`: `pip install rhino3dm`, then `python tools/3dm_to_obj.py "Sample Massing/<file>.3dm"`. The script uses the render meshes saved in the file, keeps the file's units, and converts Z-up to Y-up (Rhino +Y becomes north).
- Files uploaded on page 02 are stored in the browser (IndexedDB) only.

## Orientation

Massings are never rotated. North is Rhino +Y (OBJ −Z). A north arrow in model space shows it in every view, and wall orientations (N, NE, …) use the same convention.

## Massing OBJ guidelines

- Closed, planar faces; no interior/overlapping faces (they'd count as facade area).
- Each connected, coplanar face group becomes one paintable surface. Faces with a mostly vertical normal are walls; roofs and floors are excluded from facade area.

## Calculator controls

- Click a wall: apply the selected assembly · Shift+click: inspect · Alt+click: remove · Double-click: reset view
- APPLY TO ALL / CLEAR in the viewer corner
- RESULTS / LAYERS / TARGETS tabs above the main table
- CALCULATE refreshes the Total column · SAVE PROJECT stores assignments in the browser and downloads a `.json` · EXPORT downloads a per-surface `.csv` schedule

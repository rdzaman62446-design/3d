# Draft3D

Turn measured 2D drawings into 3D models, in the browser.

- **Floor plan mode**: draw walls on a millimetre grid (or type exact lengths), add doors and windows, or trace over a scanned plan after setting its scale. Walls are built in 3D with their openings cut out.
- **Multi-view mode**: upload front, back, left, right, top and bottom views. Each drawing's silhouette is found, and the shape that matches every view is carved out of a voxel block, then turned into a smooth mesh at the real size you enter.

Models export as **STL** and **OBJ** (millimetres) or **GLB** (metres). Everything runs on the visitor's device; nothing is uploaded.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # geometry tests
npm run build    # static site in dist/
```

## Deploy

`.github/workflows/deploy.yml` builds and publishes the site to GitHub Pages on every push to `main`. In the repository, open **Settings → Pages** and set **Source** to **GitHub Actions** once.

## How it works

| Part | File |
| --- | --- |
| Plan data, validation, sample house | `src/plan/model.js` |
| 2D editor (snapping, typed lengths, tracing) | `src/plan/editor.js` |
| Walls and openings to 3D boxes | `src/plan/build3d.js` |
| Drawing to silhouette (threshold, fill outlines, drop labels) | `src/multiview/mask.js` |
| Silhouette carving and surface-nets meshing (runs in a Web Worker) | `src/multiview/carve-core.js` |
| 3D viewer and exporters | `src/app/viewer.js` |

### View conventions (multi-view)

Model axes: X to the right, Y up, Z toward you in the front view.

| View | Seen from | Image left→right runs along |
| --- | --- | --- |
| Front | in front | +X |
| Back | behind | −X |
| Left | your left | +Z (front of the object on the right) |
| Right | your right | −Z (front of the object on the left) |
| Top | above, front edge at the bottom | +X |
| Bottom | below, front edge at the top | +X |

Each view is cropped to its drawing, so draw every view at the same scale. With **Take width and depth from the drawings** on, only the height needs entering.

### Turnaround sheets

**Split a sheet** takes one image with several views side by side. It finds each figure (labels and dimension text are dropped), then guesses its view from the outline:

- the widest full-height outlines are the front and back (the first one is taken as the front, since their outlines are mirror images);
- narrow outlines are side views, and the way the feet point decides left or right;
- outlines in between are treated as 3/4 views and skipped;
- much shorter outlines are top and bottom views.

Every guess can be changed before the views are used. **Label with Claude** sends the sheet, with each figure numbered, to Claude (`claude-opus-5-5`) and asks for each figure's view. It uses the visitor's own Anthropic API key straight from the browser; a hosted version should make this call from a server so the key stays private. Logic: `src/multiview/sheet-core.js` (tested), `src/multiview/sheet.js`, `src/multiview/ai-label.js`.

### Limits

Carving only uses outlines, so hollows that never show on an outline (eye sockets, the small of the back) come out filled. The planned AI detail pass would add those on top of the carved shape.

## Roadmap

- Accounts and saved projects (SaaS)
- DXF import for floor plans
- AI detail pass for multi-view models (server GPU)

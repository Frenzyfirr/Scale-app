# Sketch to Plan (Android, offline)

Turns a rough floor-plan sketch plus a few approximate measurements into a dimensioned plan,
with PDF, DXF, IFC, SketchUp (DAE / Ruby script / STL), 3D exports, a cut list and a build manual.
The app has no internet permission: everything runs and is stored on the phone.
Automatic wall detection needs Claude and is only in the online version.

Install: open the repository's Releases on your phone and download the newest `SketchToPlan-N.apk`.

The page source is in `src/`; `./build-page.sh` assembles it into `app/src/main/assets/index.html`.

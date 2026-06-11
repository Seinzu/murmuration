/*
  compile-synthdefs.scd
  Loads supercollider/synthdefs.scd and writes each SynthDef to a .scsyndef
  file under supercollider/synthdefs/, ready for scsynth's /d_loadDir.

  Usage:
    - Headless:  npm run synthdefs:compile   (runs `sclang` against this file)
    - SC IDE:    open and evaluate the (...) block (Cmd+Return)

  No server boot required — writeDefFile doesn't need a running server.
  When run headlessly, the trailing `0.exit` shuts sclang down cleanly.
*/

(
var here = thisProcess.nowExecutingPath.dirname;
var dir  = here +/+ "synthdefs";
var defs = thisProcess.interpreter.executeFile(here +/+ "synthdefs.scd");
File.mkdir(dir);
defs.do { | def | def.writeDefFile(dir) };
("Wrote " ++ defs.size ++ " synthdefs to " ++ dir).postln;
)

// Exit cleanly when invoked headlessly via `sclang`. Harmless in the IDE if
// you only evaluate the (...) block above.
0.exit;

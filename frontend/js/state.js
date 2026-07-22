// js/main.js — entry point: imports all modules and wires up buttons

import { initConfig } from './state.js';
import { refreshFiles, analyzeQuery, runDebugQuery, interpretResults,
         saveAllSamples, saveNotes, generateInserts, runInserts } from './notebook.js';

// Init config persistence
initConfig(document.getElementById("chatConfig"));

// Wire up all buttons
document.getElementById("btnRefresh")        ?.addEventListener("click", refreshFiles);
document.getElementById("btnAnalyze")        ?.addEventListener("click", analyzeQuery);
document.getElementById("btnRunDebug")       ?.addEventListener("click", runDebugQuery);
document.getElementById("btnInterpret")      ?.addEventListener("click", interpretResults);
document.getElementById("btnSave")           ?.addEventListener("click", saveAllSamples);
document.getElementById("btnSaveNotes")      ?.addEventListener("click", saveNotes);
document.getElementById("btnGenerateInserts")?.addEventListener("click", generateInserts);
document.getElementById("btnRunInserts")     ?.addEventListener("click", runInserts);

console.log("✅ SQL Debug Notebook loaded via ES Modules");
import "./ui/core/global.css";
import * as THREE from "three/webgpu";
import { createScene } from "./world/scene.js";
import { createWorld, createLightingController } from "./world/createWorld.js";
import { createViewmodel } from "./world/viewmodel/createViewmodel.js";
import { playerState } from "./game/playerCombat.js"; // [combat]
import { createHovercar } from "./game/hovercar.js"; // [hovercar]
import { vehicleState } from "./game/vehicleState.js";
import { applyEnvironmentMap } from "./world/envMap.js";
import { createPostProcessing } from "./post/postprocessing.js";
import { createLoaderOverlay } from "./app/createLoaderOverlay.js";
import { createAppShell } from "./app/createAppShell.js";
import { createIntroFlow } from "./app/createIntroFlow.js";
import {
  createCamera,
  createCameraLayoutSync,
  cameraParams,
} from "./bootstrap/createCamera.js";
import {
  createRenderer,
  createShadowUpdater,
  resizeRenderer,
} from "./bootstrap/createRenderer.js";
import { createCameraDirector } from "./runtime/createCameraDirector.js";
import { createRenderLoop } from "./runtime/createRenderLoop.js";
import {
  compileDeferredStartup,
  finalizeStartupLighting,
} from "./runtime/warmup.js";
import { createPerformanceDevTools } from "./debug/createPerformanceDevTools.js";
import { createInspectorSession } from "./debug/createInspectorSession.js";
import {
  createDevAppApi,
  attachDevAudio,
  attachDevPerf,
} from "./debug/createDevAppApi.js";
import {
  syncLayoutClass,
  onMobileLayoutChange,
} from "./platform/deviceLayout.js";
import { createAdaptiveDprController } from "./platform/adaptiveDpr.js";
import {
  performanceProfile,
  applyDevicePerformanceDefaults,
  shouldCompileBeforeRenderLoop,
} from "./platform/performanceProfile.js";
import { getStoredLookPreset, isDevelopmentModeEnabled } from "./platform/userPreferences.js";
import {
  DEFAULT_LOOK_PRESET,
  LOOK_PRESETS,
} from "./post/look/cyberpunkLook.js";
import { FEATURES } from "./world/features.js";
import { installGpuWatch } from "./debug/gpuWatch.js"; // [gpu]
import { setupEnemyPair } from "./ai/setupEnemyPair.js";
import { setupSamurai } from "./ai/setupSamurai.js"; // [samurai]
import {
  initDatadogRum,
  trackAction,
  trackError,
} from "./observability/datadogRum.js";

const loader = createLoaderOverlay();

init(loader).catch((error) => {
  loader.fail("Failed to load. Check the console for details.");
  console.error("Failed to initialize scene:", error);
  trackAction("webgpu_fail", { phase: "init" });
  trackError(error, { phase: "init" });
});

async function init(loaderOverlay) {
  await initDatadogRum();

  applyDevicePerformanceDefaults();
  syncLayoutClass();

  loaderOverlay.setProgress(0.03);
  loaderOverlay.setStatus("BOOTING SCENE");

  const camera = createCamera();
  const sceneResult = createScene();
  const { scene, sunLight } = sceneResult;

  loaderOverlay.setProgress(0.1);
  loaderOverlay.setStatus("SPINNING UP RENDERER");

  let renderer;
  try {
    ({ renderer } = await createRenderer());
    trackAction("webgpu_ready");
  } catch (error) {
    trackAction("webgpu_fail", { phase: "createRenderer" });
    trackError(error, { phase: "createRenderer" });
    throw error;
  }
  installGpuWatch(renderer); // [gpu]

  loaderOverlay.setProgress(0.2);
  loaderOverlay.setStatus("LINKING WEBGPU");

  const { requestShadowMapUpdate } = createShadowUpdater({
    renderer,
    getSunLight: () => sunLight,
  });

  const world = await createWorld({
    scene,
    renderer,
    camera,
    loaderOverlay,
    requestShadowMapUpdate,
  });
  trackAction("world_ready");

  loaderOverlay.setStatus("ARMING");
  try {
    world.viewmodel = await createViewmodel({ scene, renderer, world });
  } catch (error) {
    console.warn("[viewmodel] failed to load:", error);
    trackAction("viewmodel_fail");
    trackError(error, { phase: "viewmodel" });
    world.viewmodel = null;
  }

  const envMapBaseIntensity = { value: 0.08 };
  const lighting = createLightingController({
    sceneResult,
    envMapBaseIntensity,
    requestShadowMapUpdate,
  });

  lighting.syncLighting();
  requestShadowMapUpdate("init");

  loaderOverlay.setProgress(0.8);

  applyEnvironmentMap(scene, renderer, world.envTexture, {
    intensity: envMapBaseIntensity.value,
  });
  scene.environmentRotation.set(
    0,
    THREE.MathUtils.degToRad(70),
    THREE.MathUtils.degToRad(51),
  );

  loaderOverlay.setProgress(0.85);
  loaderOverlay.setStatus("WIRING POST FX");

  const pipeline = createPostProcessing(renderer, scene, camera, {
    rain: world.rain,
    smoke: world.smoke,
  });
  const post = pipeline.post;

  const storedLookPreset = getStoredLookPreset();
  const initialLookPreset =
    storedLookPreset && LOOK_PRESETS[storedLookPreset]
      ? storedLookPreset
      : DEFAULT_LOOK_PRESET;

  pipeline.applyLookPreset(initialLookPreset, {
    bloomPass: pipeline.bloomPass,
    lensflare: pipeline.lensflare,
  });

  const adaptiveDpr = createAdaptiveDprController({
    renderer,
    pipeline,
    onForcedLow: () => {
      performanceProfile.dof = false;
      pipeline.perf.setDofEnabled(false);
      performanceProfile.lensflare = false;
      pipeline.perf.setLensflareEnabled(false);
      world.billboards?.userData?.billboardMaterials?.billboard?.disable();
    },
  });
  adaptiveDpr.onResize();

  const adaptiveSampleGate = { allow: false };

  const performanceTools = createPerformanceDevTools({
    pipeline,
    ground: world.ground,
    adaptiveDpr,
    getAllowAdaptiveSample: () => adaptiveSampleGate.allow,
  });

  const walkModeBridge = { onChange: null };

  const cameraDirector = createCameraDirector({
    camera,
    renderer,
    world,
    getFinishedIntro: () =>
      !playerState.dead &&
      !vehicleState.driving &&
      (appShell?.isFinishedIntro?.() ?? false),
    onWalkModeChange: (walk) => walkModeBridge.onChange?.(walk),
  });

  let hovercar = null;

  // 2 Adams: #1 now, #2 after ~4s (never blocks boot)
  let enemyAI = null;
  if (FEATURES.trainEnemies) {
    try {
      const colliders = Array.isArray(world.colliders) ? world.colliders : [];
      const groundMesh = world.ground?.mesh ?? null;

      enemyAI = setupEnemyPair({
        camera,
        scene,
        colliders,
        ground: groundMesh,
        model: world.city ?? null,
        modelScale: 1,
        onPlayerHit: () => {
          // [roadkill] bulletproof hovercar: shots just spark on the hull
          if (vehicleState.driving) {
            hovercar?.bulletImpact?.();
            return;
          }
          playerState.hit(100);
        },
        getPlayerSpeed: () =>
          cameraDirector.walkControls?.getHorizontalSpeed?.() ?? 0,
      });
      world.enemyAI = enemyAI;
      // [samurai] melee enemy joins ~9 s after start; he shares the enemy list, so your bullets,
      // hovercar roadkill and respawns work on him automatically
      if (FEATURES.samurai) {
        setTimeout(() => {
          try {
            enemyAI.agents.push(
              setupSamurai({
                camera,
                scene,
                colliders,
                ground: groundMesh,
                model: world.city ?? null,
                spawnPoints: [new THREE.Vector3(-100, -5.4, 30), new THREE.Vector3(-70, -5.4, 33), new THREE.Vector3(-110, -5.4, 38)],
                onPlayerHit: () => {
                  if (typeof vehicleState !== "undefined" && vehicleState.driving) {
                    hovercar?.bulletImpact?.(); // bulletproof hovercar
                    return;
                  }
                  playerState.hit(100);
                },
              }),
            );
          } catch (err) {
            console.warn("[Samurai] setup failed:", err);
            trackAction("samurai_fail");
            trackError(err, { phase: "samurai" });
          }
        }, 9000);
      }
      playerState.onRespawn = () => {
        hovercar?.reset?.();
        cameraDirector.resetCameraPose();
        world.viewmodel?.refill?.();
        enemyAI?.respawn?.();
      };
      window.enemyAI = enemyAI;
      console.info("[EnemyPair] 2 NPCs (2nd delayed)");
    } catch (err) {
      console.warn("[EnemyPair] setup failed:", err);
      trackAction("enemy_pair_fail");
      trackError(err, { phase: "enemy_pair" });
      enemyAI = null;
    }
  }

  if (FEATURES.hovercar) {
    try {
      hovercar = createHovercar({
        scene,
        renderer,
        world,
        camera,
        getWalkControls: () => cameraDirector.walkControls,
        isActive: () => (appShell?.isFinishedIntro?.() ?? false) && !playerState.dead,
      });
    } catch (err) {
      console.warn("[hovercar] setup failed:", err);
      hovercar = null;
    }
  }

  const cameraLayout = createCameraLayoutSync({
    camera,
    getWalkControls: () => cameraDirector.walkControls,
  });

  const inspectorSession = createInspectorSession({
    renderer,
    pipeline,
    sceneResult,
    world,
    cameraDirector,
    cameraParams,
    applyCameraFovForLayout: cameraLayout.applyCameraFovForLayout,
    syncWalkEyeHeight: cameraLayout.syncWalkEyeHeight,
    syncLighting: lighting.syncLighting,
    syncEnvironmentIntensity: lighting.syncEnvironmentIntensity,
    envMapBaseIntensity,
    requestShadowMapUpdate,
    adaptiveDpr,
  });

  const appShell = createAppShell({
    renderer,
    camera,
    cameraDirector,
    world,
    pipeline,
    inspectorSession,
    syncLighting: lighting.syncLighting,
  });

  walkModeBridge.onChange = appShell.onWalkModeChange;

  const devApp = createDevAppApi({
    scene,
    world,
    camera,
    controls: cameraDirector.controls,
  });
  attachDevPerf(devApp, performanceTools.perfApi);

  const { carEngineAudio, planeEngineAudio, wetFootstepAudio } =
    await appShell.initAudio();
  cameraDirector.setFootstepAudio(wetFootstepAudio);
  attachDevAudio(devApp, carEngineAudio, planeEngineAudio, wetFootstepAudio);

  appShell.bindIdleListeners();
  appShell.bindOrbitIdleListeners(cameraDirector.controls);

  cameraDirector.preparePreRevealPose();

  const introFlow = createIntroFlow({
    pipeline,
    renderer,
    loaderOverlay,
    revealAppUi: () => {
      appShell.revealAppUi();
      adaptiveSampleGate.allow = true;
    },
    world,
  });

  const renderLoop = createRenderLoop({
    camera,
    cameraDirector,
    world,
    pipeline,
    post,
    performanceTools,
    renderer,
    getRainGlassIntro: introFlow.getRainGlassIntro,
    getIntroActive: introFlow.isIntroActive,
    onFrame: (delta) => {
      appShell.updateHud(delta);
      try {
        hovercar?.update(delta);
      } catch (err) {
        console.warn("[hovercar] update failed:", err);
      }
      world.viewmodel?.update(delta, {
        camera,
        walkControls: cameraDirector.walkControls,
        enabled:
          (appShell.isFinishedIntro?.() ?? false) &&
          !playerState.dead &&
          !vehicleState.driving,
      });
      try {
        enemyAI?.update(
          delta,
          (appShell.isFinishedIntro?.() ?? false) && !playerState.dead,
        );
      } catch {
        /* ignore */
      }
    },
  });

  await finalizeStartupLighting({
    loaderOverlay,
    syncLighting: lighting.syncLighting,
    requestShadowMapUpdate,
    renderer,
    scene,
    pipeline,
    camera,
    world,
    post,
  });

  const deferredCompile = compileDeferredStartup({
    renderer,
    scene,
    pipeline,
    camera,
    world,
  }).catch((error) => {
    console.warn("[warmup] Deferred shader compile failed:", error);
  });

  if (shouldCompileBeforeRenderLoop()) {
    await deferredCompile;
  }

  renderLoop.startLoop();

  window.addEventListener("resize", () => {
    syncLayoutClass();
    cameraLayout.onWindowResizeAspect();
    resizeRenderer(renderer, pipeline, adaptiveDpr);
    requestShadowMapUpdate("resize");
  });

  onMobileLayoutChange(() => {
    syncLayoutClass();
    cameraLayout.applyCameraFovForLayout();
  });

  await introFlow.run();
  trackAction("intro_complete");

  if (!shouldCompileBeforeRenderLoop()) {
    await deferredCompile;
  }

  inspectorSession.bootstrapInspector(appShell.settingsPanel);

  if (isDevelopmentModeEnabled()) {
    inspectorSession.revealInspector();
  }
}

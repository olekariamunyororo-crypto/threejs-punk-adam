const fs = require('fs');
const F = 'src/ai/setupEnemyAI.js';
let s = fs.readFileSync(F, 'utf8');
if (s.includes('[aim]')) { console.log('skip (already patched):', F); process.exit(0); }
const sub = (a, b) => { if (!s.includes(a)) throw new Error('pattern not found: ' + a.slice(0, 70)); s = s.replace(a, b); };

// 1) one-handed aim layer + body-only clips (built once from the GLB's own clips)
sub('        console.info(\n          "[EnemyAI] animations:",', `        // [aim] right arm + spine + head aim; legs, hips and left arm keep walking
        const AIM = /^(Spine\\d*|Neck|Head|HeadTop|RightShoulder|RightArm|RightForeArm|RightHand)\\./;
        const subClip = (name, aimPart) => {
          const src = gltf.animations.find((c) => c.name === name);
          if (!src) return null;
          const tracks = src.tracks.filter((t) => AIM.test(t.name) === aimPart);
          if (!tracks.length) return null;
          return mixer.clipAction(new THREE.AnimationClip(name + (aimPart ? "_aim" : "_body"), src.duration, tracks));
        };
        actions.AttackAim = subClip("Attack", true);
        actions.WalkBody = subClip("Walk", false);
        actions.IdleBody = subClip("Idle", false);
        console.info(
          "[EnemyAI] animations:",`);

// 2) second animation channel for the aiming layer
sub('    next.reset().setEffectiveWeight(1).fadeIn(0.2).play();\n    currentAction = next;\n  }\n', `    next.reset().setEffectiveWeight(1).fadeIn(0.2).play();
    currentAction = next;
  }

  let upperAction = null; // [aim]
  function playUpper(next) {
    if (upperAction === next) return;
    if (upperAction) upperAction.fadeOut(0.2);
    if (next) next.reset().setEffectiveWeight(1).fadeIn(0.2).play();
    upperAction = next;
  }
`);

// 3) choose clips: attacking no longer freezes the legs / raises both arms
sub('    let want = idleClip;\n', '    let want = idleClip;\n    let upper = null;\n');
sub('    else if (state === "attack" && attackClip) want = attackClip;\n', `    else if (state === "attack" && attackClip) {
      if (actions.AttackAim && actions.WalkBody && actions.IdleBody) {
        want = moved ? actions.WalkBody : actions.IdleBody;
        upper = actions.AttackAim;
      } else want = attackClip;
    }
`);
sub('    if (want) playClip(want);\n', '    if (want) playClip(want);\n    playUpper(upper);\n');
fs.writeFileSync(F, s);
console.log('patched', F);

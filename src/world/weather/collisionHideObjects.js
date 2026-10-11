export function collectCollisionHideObjects({
  rain,
  smoke,
  planes,
  sky,
  viewmodel,
} = {}) {
  const hideObjects = [];

  if (rain?.group) {
    hideObjects.push(rain.group);
  }

  if (sky?.mesh) {
    hideObjects.push(sky.mesh);
  }

  if (planes?.group) {
    hideObjects.push(planes.group);
  }

  if (smoke?.emitters) {
    for (const emitter of smoke.emitters) {
      if (emitter?.mesh) {
        hideObjects.push(emitter.mesh);
      }
    }
  }

  if (viewmodel?.hideObjects) {
    hideObjects.push(...viewmodel.hideObjects);
  }

  return hideObjects;
}

import type * as THREE from "three";

interface Watch {
  /** The query around the draw going on, and the one whose answer is awaited. */
  active: WebGLQuery | null;
  pending: WebGLQuery | null;
  drawn: boolean;
  /** When the GPU was last asked (ms). */
  asked: number;
}

export interface DrawnWatch {
  /**
   * Whether the mesh drew any pixel the last time the GPU told, for this camera. Takes the GPU's answer to the
   * last question if it has come.
   */
  drawn(renderer: THREE.WebGLRenderer, camera: THREE.Camera): boolean;
  /** Whether the GPU was last asked for this camera at least `every` ms before `now`. */
  due(camera: THREE.Camera, now: number, every: number): boolean;
  /** Back to counting as drawn for this camera (or for all), until the GPU tells again. */
  assume(camera?: THREE.Camera): void;
}

/**
 * Tells whether a mesh draws any pixel at all, per camera it is drawn for. The GPU is asked, with an occlusion
 * query around each draw of the mesh, and answers a frame or two later: until then the mesh counts as drawn, so
 * whatever depends on it is done once too often rather than once too seldom.
 */
export function watchDrawn(mesh: THREE.Mesh, now: () => number = () => performance.now()): DrawnWatch {
  let watches = new WeakMap<THREE.Camera, Watch>();
  const watchFor = (camera: THREE.Camera): Watch => {
    let watch = watches.get(camera);
    if (!watch) {
      watch = { active: null, pending: null, drawn: true, asked: -Infinity };
      watches.set(camera, watch);
    }
    return watch;
  };
  const queries = (renderer: THREE.WebGLRenderer): WebGL2RenderingContext | null => {
    const gl = renderer.getContext?.() as WebGL2RenderingContext | undefined;
    return gl && typeof gl.createQuery === "function" ? gl : null;
  };
  mesh.onBeforeRender = (renderer, _scene, camera) => {
    const gl = queries(renderer);
    const watch = watchFor(camera);
    watch.asked = now();
    // One question at a time: the next is asked once the last is answered.
    if (gl && !watch.pending) {
      watch.active = gl.createQuery();
      if (watch.active) {
        gl.beginQuery(gl.ANY_SAMPLES_PASSED, watch.active);
      }
    }
  };
  mesh.onAfterRender = (renderer, _scene, camera) => {
    const gl = queries(renderer);
    const watch = watchFor(camera);
    if (gl && watch.active) {
      gl.endQuery(gl.ANY_SAMPLES_PASSED);
      watch.pending = watch.active;
      watch.active = null;
    }
  };
  return {
    drawn: (renderer, camera) => {
      const gl = queries(renderer);
      const watch = watchFor(camera);
      if (gl && watch.pending && gl.getQueryParameter(watch.pending, gl.QUERY_RESULT_AVAILABLE)) {
        watch.drawn = Boolean(gl.getQueryParameter(watch.pending, gl.QUERY_RESULT));
        gl.deleteQuery(watch.pending);
        watch.pending = null;
      }
      return watch.drawn;
    },
    due: (camera, time, every) => time - watchFor(camera).asked >= every,
    assume: (camera) => {
      if (camera) {
        // An answer still on its way is to a question from before.
        Object.assign(watchFor(camera), { drawn: true, pending: null });
      } else {
        // Whatever was asked is lost with the context it was asked of.
        watches = new WeakMap();
      }
    },
  };
}

var app = (function () {
    'use strict';

    function noop() { }
    function add_location(element, file, line, column, char) {
        element.__svelte_meta = {
            loc: { file, line, column, char }
        };
    }
    function run(fn) {
        return fn();
    }
    function blank_object() {
        return Object.create(null);
    }
    function run_all(fns) {
        fns.forEach(run);
    }
    function is_function(thing) {
        return typeof thing === 'function';
    }
    function safe_not_equal(a, b) {
        return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
    }
    function is_empty(obj) {
        return Object.keys(obj).length === 0;
    }

    function append(target, node) {
        target.appendChild(node);
    }
    function insert(target, node, anchor) {
        target.insertBefore(node, anchor || null);
    }
    function detach(node) {
        node.parentNode.removeChild(node);
    }
    function destroy_each(iterations, detaching) {
        for (let i = 0; i < iterations.length; i += 1) {
            if (iterations[i])
                iterations[i].d(detaching);
        }
    }
    function element(name) {
        return document.createElement(name);
    }
    function text(data) {
        return document.createTextNode(data);
    }
    function space() {
        return text(' ');
    }
    function listen(node, event, handler, options) {
        node.addEventListener(event, handler, options);
        return () => node.removeEventListener(event, handler, options);
    }
    function attr(node, attribute, value) {
        if (value == null)
            node.removeAttribute(attribute);
        else if (node.getAttribute(attribute) !== value)
            node.setAttribute(attribute, value);
    }
    function children(element) {
        return Array.from(element.childNodes);
    }
    function custom_event(type, detail) {
        const e = document.createEvent('CustomEvent');
        e.initCustomEvent(type, false, false, detail);
        return e;
    }

    let current_component;
    function set_current_component(component) {
        current_component = component;
    }
    function get_current_component() {
        if (!current_component)
            throw new Error('Function called outside component initialization');
        return current_component;
    }
    function onMount(fn) {
        get_current_component().$$.on_mount.push(fn);
    }

    const dirty_components = [];
    const binding_callbacks = [];
    const render_callbacks = [];
    const flush_callbacks = [];
    const resolved_promise = Promise.resolve();
    let update_scheduled = false;
    function schedule_update() {
        if (!update_scheduled) {
            update_scheduled = true;
            resolved_promise.then(flush);
        }
    }
    function add_render_callback(fn) {
        render_callbacks.push(fn);
    }
    let flushing = false;
    const seen_callbacks = new Set();
    function flush() {
        if (flushing)
            return;
        flushing = true;
        do {
            // first, call beforeUpdate functions
            // and update components
            for (let i = 0; i < dirty_components.length; i += 1) {
                const component = dirty_components[i];
                set_current_component(component);
                update(component.$$);
            }
            set_current_component(null);
            dirty_components.length = 0;
            while (binding_callbacks.length)
                binding_callbacks.pop()();
            // then, once components are updated, call
            // afterUpdate functions. This may cause
            // subsequent updates...
            for (let i = 0; i < render_callbacks.length; i += 1) {
                const callback = render_callbacks[i];
                if (!seen_callbacks.has(callback)) {
                    // ...so guard against infinite loops
                    seen_callbacks.add(callback);
                    callback();
                }
            }
            render_callbacks.length = 0;
        } while (dirty_components.length);
        while (flush_callbacks.length) {
            flush_callbacks.pop()();
        }
        update_scheduled = false;
        flushing = false;
        seen_callbacks.clear();
    }
    function update($$) {
        if ($$.fragment !== null) {
            $$.update();
            run_all($$.before_update);
            const dirty = $$.dirty;
            $$.dirty = [-1];
            $$.fragment && $$.fragment.p($$.ctx, dirty);
            $$.after_update.forEach(add_render_callback);
        }
    }
    const outroing = new Set();
    let outros;
    function group_outros() {
        outros = {
            r: 0,
            c: [],
            p: outros // parent group
        };
    }
    function check_outros() {
        if (!outros.r) {
            run_all(outros.c);
        }
        outros = outros.p;
    }
    function transition_in(block, local) {
        if (block && block.i) {
            outroing.delete(block);
            block.i(local);
        }
    }
    function transition_out(block, local, detach, callback) {
        if (block && block.o) {
            if (outroing.has(block))
                return;
            outroing.add(block);
            outros.c.push(() => {
                outroing.delete(block);
                if (callback) {
                    if (detach)
                        block.d(1);
                    callback();
                }
            });
            block.o(local);
        }
    }
    function create_component(block) {
        block && block.c();
    }
    function mount_component(component, target, anchor) {
        const { fragment, on_mount, on_destroy, after_update } = component.$$;
        fragment && fragment.m(target, anchor);
        // onMount happens before the initial afterUpdate
        add_render_callback(() => {
            const new_on_destroy = on_mount.map(run).filter(is_function);
            if (on_destroy) {
                on_destroy.push(...new_on_destroy);
            }
            else {
                // Edge case - component was destroyed immediately,
                // most likely as a result of a binding initialising
                run_all(new_on_destroy);
            }
            component.$$.on_mount = [];
        });
        after_update.forEach(add_render_callback);
    }
    function destroy_component(component, detaching) {
        const $$ = component.$$;
        if ($$.fragment !== null) {
            run_all($$.on_destroy);
            $$.fragment && $$.fragment.d(detaching);
            // TODO null out other refs, including component.$$ (but need to
            // preserve final state?)
            $$.on_destroy = $$.fragment = null;
            $$.ctx = [];
        }
    }
    function make_dirty(component, i) {
        if (component.$$.dirty[0] === -1) {
            dirty_components.push(component);
            schedule_update();
            component.$$.dirty.fill(0);
        }
        component.$$.dirty[(i / 31) | 0] |= (1 << (i % 31));
    }
    function init(component, options, instance, create_fragment, not_equal, props, dirty = [-1]) {
        const parent_component = current_component;
        set_current_component(component);
        const $$ = component.$$ = {
            fragment: null,
            ctx: null,
            // state
            props,
            update: noop,
            not_equal,
            bound: blank_object(),
            // lifecycle
            on_mount: [],
            on_destroy: [],
            before_update: [],
            after_update: [],
            context: new Map(parent_component ? parent_component.$$.context : []),
            // everything else
            callbacks: blank_object(),
            dirty,
            skip_bound: false
        };
        let ready = false;
        $$.ctx = instance
            ? instance(component, options.props || {}, (i, ret, ...rest) => {
                const value = rest.length ? rest[0] : ret;
                if ($$.ctx && not_equal($$.ctx[i], $$.ctx[i] = value)) {
                    if (!$$.skip_bound && $$.bound[i])
                        $$.bound[i](value);
                    if (ready)
                        make_dirty(component, i);
                }
                return ret;
            })
            : [];
        $$.update();
        ready = true;
        run_all($$.before_update);
        // `false` as a special case of no DOM component
        $$.fragment = create_fragment ? create_fragment($$.ctx) : false;
        if (options.target) {
            if (options.hydrate) {
                const nodes = children(options.target);
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.l(nodes);
                nodes.forEach(detach);
            }
            else {
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                $$.fragment && $$.fragment.c();
            }
            if (options.intro)
                transition_in(component.$$.fragment);
            mount_component(component, options.target, options.anchor);
            flush();
        }
        set_current_component(parent_component);
    }
    /**
     * Base class for Svelte components. Used when dev=false.
     */
    class SvelteComponent {
        $destroy() {
            destroy_component(this, 1);
            this.$destroy = noop;
        }
        $on(type, callback) {
            const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
            callbacks.push(callback);
            return () => {
                const index = callbacks.indexOf(callback);
                if (index !== -1)
                    callbacks.splice(index, 1);
            };
        }
        $set($$props) {
            if (this.$$set && !is_empty($$props)) {
                this.$$.skip_bound = true;
                this.$$set($$props);
                this.$$.skip_bound = false;
            }
        }
    }

    function dispatch_dev(type, detail) {
        document.dispatchEvent(custom_event(type, Object.assign({ version: '3.32.1' }, detail)));
    }
    function append_dev(target, node) {
        dispatch_dev('SvelteDOMInsert', { target, node });
        append(target, node);
    }
    function insert_dev(target, node, anchor) {
        dispatch_dev('SvelteDOMInsert', { target, node, anchor });
        insert(target, node, anchor);
    }
    function detach_dev(node) {
        dispatch_dev('SvelteDOMRemove', { node });
        detach(node);
    }
    function listen_dev(node, event, handler, options, has_prevent_default, has_stop_propagation) {
        const modifiers = options === true ? ['capture'] : options ? Array.from(Object.keys(options)) : [];
        if (has_prevent_default)
            modifiers.push('preventDefault');
        if (has_stop_propagation)
            modifiers.push('stopPropagation');
        dispatch_dev('SvelteDOMAddEventListener', { node, event, handler, modifiers });
        const dispose = listen(node, event, handler, options);
        return () => {
            dispatch_dev('SvelteDOMRemoveEventListener', { node, event, handler, modifiers });
            dispose();
        };
    }
    function attr_dev(node, attribute, value) {
        attr(node, attribute, value);
        if (value == null)
            dispatch_dev('SvelteDOMRemoveAttribute', { node, attribute });
        else
            dispatch_dev('SvelteDOMSetAttribute', { node, attribute, value });
    }
    function set_data_dev(text, data) {
        data = '' + data;
        if (text.wholeText === data)
            return;
        dispatch_dev('SvelteDOMSetData', { node: text, data });
        text.data = data;
    }
    function validate_each_argument(arg) {
        if (typeof arg !== 'string' && !(arg && typeof arg === 'object' && 'length' in arg)) {
            let msg = '{#each} only iterates over array-like objects.';
            if (typeof Symbol === 'function' && arg && Symbol.iterator in arg) {
                msg += ' You can use a spread to convert this iterable into an array.';
            }
            throw new Error(msg);
        }
    }
    function validate_slots(name, slot, keys) {
        for (const slot_key of Object.keys(slot)) {
            if (!~keys.indexOf(slot_key)) {
                console.warn(`<${name}> received an unexpected slot "${slot_key}".`);
            }
        }
    }
    /**
     * Base class for Svelte components with some minor dev-enhancements. Used when dev=true.
     */
    class SvelteComponentDev extends SvelteComponent {
        constructor(options) {
            if (!options || (!options.target && !options.$$inline)) {
                throw new Error("'target' is a required option");
            }
            super();
        }
        $destroy() {
            super.$destroy();
            this.$destroy = () => {
                console.warn('Component was already destroyed'); // eslint-disable-line no-console
            };
        }
        $capture_state() { }
        $inject_state() { }
    }

    // canvas-confetti v1.3.3 built on 2021-01-16T22:50:46.932Z
    var module = {};

    // source content
    (function main(global, module, isWorker, workerSize) {
      var canUseWorker = !!(
        global.Worker &&
        global.Blob &&
        global.Promise &&
        global.OffscreenCanvas &&
        global.OffscreenCanvasRenderingContext2D &&
        global.HTMLCanvasElement &&
        global.HTMLCanvasElement.prototype.transferControlToOffscreen &&
        global.URL &&
        global.URL.createObjectURL);

      function noop() {}

      // create a promise if it exists, otherwise, just
      // call the function directly
      function promise(func) {
        var ModulePromise = module.exports.Promise;
        var Prom = ModulePromise !== void 0 ? ModulePromise : global.Promise;

        if (typeof Prom === 'function') {
          return new Prom(func);
        }

        func(noop, noop);

        return null;
      }

      var raf = (function () {
        var TIME = Math.floor(1000 / 60);
        var frame, cancel;
        var frames = {};
        var lastFrameTime = 0;

        if (typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function') {
          frame = function (cb) {
            var id = Math.random();

            frames[id] = requestAnimationFrame(function onFrame(time) {
              if (lastFrameTime === time || lastFrameTime + TIME - 1 < time) {
                lastFrameTime = time;
                delete frames[id];

                cb();
              } else {
                frames[id] = requestAnimationFrame(onFrame);
              }
            });

            return id;
          };
          cancel = function (id) {
            if (frames[id]) {
              cancelAnimationFrame(frames[id]);
            }
          };
        } else {
          frame = function (cb) {
            return setTimeout(cb, TIME);
          };
          cancel = function (timer) {
            return clearTimeout(timer);
          };
        }

        return { frame: frame, cancel: cancel };
      }());

      var getWorker = (function () {
        var worker;
        var prom;
        var resolves = {};

        function decorate(worker) {
          function execute(options, callback) {
            worker.postMessage({ options: options || {}, callback: callback });
          }
          worker.init = function initWorker(canvas) {
            var offscreen = canvas.transferControlToOffscreen();
            worker.postMessage({ canvas: offscreen }, [offscreen]);
          };

          worker.fire = function fireWorker(options, size, done) {
            if (prom) {
              execute(options, null);
              return prom;
            }

            var id = Math.random().toString(36).slice(2);

            prom = promise(function (resolve) {
              function workerDone(msg) {
                if (msg.data.callback !== id) {
                  return;
                }

                delete resolves[id];
                worker.removeEventListener('message', workerDone);

                prom = null;
                done();
                resolve();
              }

              worker.addEventListener('message', workerDone);
              execute(options, id);

              resolves[id] = workerDone.bind(null, { data: { callback: id }});
            });

            return prom;
          };

          worker.reset = function resetWorker() {
            worker.postMessage({ reset: true });

            for (var id in resolves) {
              resolves[id]();
              delete resolves[id];
            }
          };
        }

        return function () {
          if (worker) {
            return worker;
          }

          if (!isWorker && canUseWorker) {
            var code = [
              'var CONFETTI, SIZE = {}, module = {};',
              '(' + main.toString() + ')(this, module, true, SIZE);',
              'onmessage = function(msg) {',
              '  if (msg.data.options) {',
              '    CONFETTI(msg.data.options).then(function () {',
              '      if (msg.data.callback) {',
              '        postMessage({ callback: msg.data.callback });',
              '      }',
              '    });',
              '  } else if (msg.data.reset) {',
              '    CONFETTI.reset();',
              '  } else if (msg.data.resize) {',
              '    SIZE.width = msg.data.resize.width;',
              '    SIZE.height = msg.data.resize.height;',
              '  } else if (msg.data.canvas) {',
              '    SIZE.width = msg.data.canvas.width;',
              '    SIZE.height = msg.data.canvas.height;',
              '    CONFETTI = module.exports.create(msg.data.canvas);',
              '  }',
              '}',
            ].join('\n');
            try {
              worker = new Worker(URL.createObjectURL(new Blob([code])));
            } catch (e) {
              // eslint-disable-next-line no-console
              typeof console !== undefined && typeof console.warn === 'function' ? console.warn('🎊 Could not load worker', e) : null;

              return null;
            }

            decorate(worker);
          }

          return worker;
        };
      })();

      var defaults = {
        particleCount: 50,
        angle: 90,
        spread: 45,
        startVelocity: 45,
        decay: 0.9,
        gravity: 1,
        ticks: 200,
        x: 0.5,
        y: 0.5,
        shapes: ['square', 'circle'],
        zIndex: 100,
        colors: [
          '#26ccff',
          '#a25afd',
          '#ff5e7e',
          '#88ff5a',
          '#fcff42',
          '#ffa62d',
          '#ff36ff'
        ],
        // probably should be true, but back-compat
        disableForReducedMotion: false,
        scalar: 1
      };

      function convert(val, transform) {
        return transform ? transform(val) : val;
      }

      function isOk(val) {
        return !(val === null || val === undefined);
      }

      function prop(options, name, transform) {
        return convert(
          options && isOk(options[name]) ? options[name] : defaults[name],
          transform
        );
      }

      function onlyPositiveInt(number){
        return number < 0 ? 0 : Math.floor(number);
      }

      function randomInt(min, max) {
        // [min, max)
        return Math.floor(Math.random() * (max - min)) + min;
      }

      function toDecimal(str) {
        return parseInt(str, 16);
      }

      function colorsToRgb(colors) {
        return colors.map(hexToRgb);
      }

      function hexToRgb(str) {
        var val = String(str).replace(/[^0-9a-f]/gi, '');

        if (val.length < 6) {
            val = val[0]+val[0]+val[1]+val[1]+val[2]+val[2];
        }

        return {
          r: toDecimal(val.substring(0,2)),
          g: toDecimal(val.substring(2,4)),
          b: toDecimal(val.substring(4,6))
        };
      }

      function getOrigin(options) {
        var origin = prop(options, 'origin', Object);
        origin.x = prop(origin, 'x', Number);
        origin.y = prop(origin, 'y', Number);

        return origin;
      }

      function setCanvasWindowSize(canvas) {
        canvas.width = document.documentElement.clientWidth;
        canvas.height = document.documentElement.clientHeight;
      }

      function setCanvasRectSize(canvas) {
        var rect = canvas.getBoundingClientRect();
        canvas.width = rect.width;
        canvas.height = rect.height;
      }

      function getCanvas(zIndex) {
        var canvas = document.createElement('canvas');

        canvas.style.position = 'fixed';
        canvas.style.top = '0px';
        canvas.style.left = '0px';
        canvas.style.pointerEvents = 'none';
        canvas.style.zIndex = zIndex;

        return canvas;
      }

      function ellipse(context, x, y, radiusX, radiusY, rotation, startAngle, endAngle, antiClockwise) {
        context.save();
        context.translate(x, y);
        context.rotate(rotation);
        context.scale(radiusX, radiusY);
        context.arc(0, 0, 1, startAngle, endAngle, antiClockwise);
        context.restore();
      }

      function randomPhysics(opts) {
        var radAngle = opts.angle * (Math.PI / 180);
        var radSpread = opts.spread * (Math.PI / 180);

        return {
          x: opts.x,
          y: opts.y,
          wobble: Math.random() * 10,
          velocity: (opts.startVelocity * 0.5) + (Math.random() * opts.startVelocity),
          angle2D: -radAngle + ((0.5 * radSpread) - (Math.random() * radSpread)),
          tiltAngle: Math.random() * Math.PI,
          color: opts.color,
          shape: opts.shape,
          tick: 0,
          totalTicks: opts.ticks,
          decay: opts.decay,
          random: Math.random() + 5,
          tiltSin: 0,
          tiltCos: 0,
          wobbleX: 0,
          wobbleY: 0,
          gravity: opts.gravity * 3,
          ovalScalar: 0.6,
          scalar: opts.scalar
        };
      }

      function updateFetti(context, fetti) {
        fetti.x += Math.cos(fetti.angle2D) * fetti.velocity;
        fetti.y += Math.sin(fetti.angle2D) * fetti.velocity + fetti.gravity;
        fetti.wobble += 0.1;
        fetti.velocity *= fetti.decay;
        fetti.tiltAngle += 0.1;
        fetti.tiltSin = Math.sin(fetti.tiltAngle);
        fetti.tiltCos = Math.cos(fetti.tiltAngle);
        fetti.random = Math.random() + 5;
        fetti.wobbleX = fetti.x + ((10 * fetti.scalar) * Math.cos(fetti.wobble));
        fetti.wobbleY = fetti.y + ((10 * fetti.scalar) * Math.sin(fetti.wobble));

        var progress = (fetti.tick++) / fetti.totalTicks;

        var x1 = fetti.x + (fetti.random * fetti.tiltCos);
        var y1 = fetti.y + (fetti.random * fetti.tiltSin);
        var x2 = fetti.wobbleX + (fetti.random * fetti.tiltCos);
        var y2 = fetti.wobbleY + (fetti.random * fetti.tiltSin);

        context.fillStyle = 'rgba(' + fetti.color.r + ', ' + fetti.color.g + ', ' + fetti.color.b + ', ' + (1 - progress) + ')';
        context.beginPath();

        if (fetti.shape === 'circle') {
          context.ellipse ?
            context.ellipse(fetti.x, fetti.y, Math.abs(x2 - x1) * fetti.ovalScalar, Math.abs(y2 - y1) * fetti.ovalScalar, Math.PI / 10 * fetti.wobble, 0, 2 * Math.PI) :
            ellipse(context, fetti.x, fetti.y, Math.abs(x2 - x1) * fetti.ovalScalar, Math.abs(y2 - y1) * fetti.ovalScalar, Math.PI / 10 * fetti.wobble, 0, 2 * Math.PI);
        } else {
          context.moveTo(Math.floor(fetti.x), Math.floor(fetti.y));
          context.lineTo(Math.floor(fetti.wobbleX), Math.floor(y1));
          context.lineTo(Math.floor(x2), Math.floor(y2));
          context.lineTo(Math.floor(x1), Math.floor(fetti.wobbleY));
        }

        context.closePath();
        context.fill();

        return fetti.tick < fetti.totalTicks;
      }

      function animate(canvas, fettis, resizer, size, done) {
        var animatingFettis = fettis.slice();
        var context = canvas.getContext('2d');
        var animationFrame;
        var destroy;

        var prom = promise(function (resolve) {
          function onDone() {
            animationFrame = destroy = null;

            context.clearRect(0, 0, size.width, size.height);

            done();
            resolve();
          }

          function update() {
            if (isWorker && !(size.width === workerSize.width && size.height === workerSize.height)) {
              size.width = canvas.width = workerSize.width;
              size.height = canvas.height = workerSize.height;
            }

            if (!size.width && !size.height) {
              resizer(canvas);
              size.width = canvas.width;
              size.height = canvas.height;
            }

            context.clearRect(0, 0, size.width, size.height);

            animatingFettis = animatingFettis.filter(function (fetti) {
              return updateFetti(context, fetti);
            });

            if (animatingFettis.length) {
              animationFrame = raf.frame(update);
            } else {
              onDone();
            }
          }

          animationFrame = raf.frame(update);
          destroy = onDone;
        });

        return {
          addFettis: function (fettis) {
            animatingFettis = animatingFettis.concat(fettis);

            return prom;
          },
          canvas: canvas,
          promise: prom,
          reset: function () {
            if (animationFrame) {
              raf.cancel(animationFrame);
            }

            if (destroy) {
              destroy();
            }
          }
        };
      }

      function confettiCannon(canvas, globalOpts) {
        var isLibCanvas = !canvas;
        var allowResize = !!prop(globalOpts || {}, 'resize');
        var globalDisableForReducedMotion = prop(globalOpts, 'disableForReducedMotion', Boolean);
        var shouldUseWorker = canUseWorker && !!prop(globalOpts || {}, 'useWorker');
        var worker = shouldUseWorker ? getWorker() : null;
        var resizer = isLibCanvas ? setCanvasWindowSize : setCanvasRectSize;
        var initialized = (canvas && worker) ? !!canvas.__confetti_initialized : false;
        var preferLessMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion)').matches;
        var animationObj;

        function fireLocal(options, size, done) {
          var particleCount = prop(options, 'particleCount', onlyPositiveInt);
          var angle = prop(options, 'angle', Number);
          var spread = prop(options, 'spread', Number);
          var startVelocity = prop(options, 'startVelocity', Number);
          var decay = prop(options, 'decay', Number);
          var gravity = prop(options, 'gravity', Number);
          var colors = prop(options, 'colors', colorsToRgb);
          var ticks = prop(options, 'ticks', Number);
          var shapes = prop(options, 'shapes');
          var scalar = prop(options, 'scalar');
          var origin = getOrigin(options);

          var temp = particleCount;
          var fettis = [];

          var startX = canvas.width * origin.x;
          var startY = canvas.height * origin.y;

          while (temp--) {
            fettis.push(
              randomPhysics({
                x: startX,
                y: startY,
                angle: angle,
                spread: spread,
                startVelocity: startVelocity,
                color: colors[temp % colors.length],
                shape: shapes[randomInt(0, shapes.length)],
                ticks: ticks,
                decay: decay,
                gravity: gravity,
                scalar: scalar
              })
            );
          }

          // if we have a previous canvas already animating,
          // add to it
          if (animationObj) {
            return animationObj.addFettis(fettis);
          }

          animationObj = animate(canvas, fettis, resizer, size , done);

          return animationObj.promise;
        }

        function fire(options) {
          var disableForReducedMotion = globalDisableForReducedMotion || prop(options, 'disableForReducedMotion', Boolean);
          var zIndex = prop(options, 'zIndex', Number);

          if (disableForReducedMotion && preferLessMotion) {
            return promise(function (resolve) {
              resolve();
            });
          }

          if (isLibCanvas && animationObj) {
            // use existing canvas from in-progress animation
            canvas = animationObj.canvas;
          } else if (isLibCanvas && !canvas) {
            // create and initialize a new canvas
            canvas = getCanvas(zIndex);
            document.body.appendChild(canvas);
          }

          if (allowResize && !initialized) {
            // initialize the size of a user-supplied canvas
            resizer(canvas);
          }

          var size = {
            width: canvas.width,
            height: canvas.height
          };

          if (worker && !initialized) {
            worker.init(canvas);
          }

          initialized = true;

          if (worker) {
            canvas.__confetti_initialized = true;
          }

          function onResize() {
            if (worker) {
              // TODO this really shouldn't be immediate, because it is expensive
              var obj = {
                getBoundingClientRect: function () {
                  if (!isLibCanvas) {
                    return canvas.getBoundingClientRect();
                  }
                }
              };

              resizer(obj);

              worker.postMessage({
                resize: {
                  width: obj.width,
                  height: obj.height
                }
              });
              return;
            }

            // don't actually query the size here, since this
            // can execute frequently and rapidly
            size.width = size.height = null;
          }

          function done() {
            animationObj = null;

            if (allowResize) {
              global.removeEventListener('resize', onResize);
            }

            if (isLibCanvas && canvas) {
              document.body.removeChild(canvas);
              canvas = null;
              initialized = false;
            }
          }

          if (allowResize) {
            global.addEventListener('resize', onResize, false);
          }

          if (worker) {
            return worker.fire(options, size, done);
          }

          return fireLocal(options, size, done);
        }

        fire.reset = function () {
          if (worker) {
            worker.reset();
          }

          if (animationObj) {
            animationObj.reset();
          }
        };

        return fire;
      }

      module.exports = confettiCannon(null, { useWorker: true, resize: true });
      module.exports.create = confettiCannon;
    }((function () {
      if (typeof window !== 'undefined') {
        return window;
      }

      if (typeof self !== 'undefined') {
        return self;
      }

      return this || {};
    })(), module, false));

    // end source content

    var confetti = module.exports;
    module.exports.create;

    // prior f-art goes to fartscroll.js. https://github.com/theonion/fartscroll.js
    // 2.0 of fart just exports the raw files so they can be used elsewhere.

    const mp3 = {
      prefix: "data:audio/mp3;base64,",
      sound: [
        "SUQzAwAAAAALClRJVDIAAABkAAAAAAAAAGQgRWZmZWN0cyAtIENvbWVkeS9DYXJ0b29uIEZBUlQgV0lUSCBHT09EIEVORElORzogU3RhcnRzIGJpZyBhbmQgbG91ZCwgZW5kcyB3aXRoIGEgYmFzaWMgJ3BycnQnVFBFMQAAADQAAABEb3dubG9hZCBTb3VuZCBFZmZlY3RzIC0gU291bmREb2dzIC0gQmpvcm4gTHlubmUgRlhUQUxCAAAAGQAAAGh0dHA6Ly93d3cuU291bmRkb2dzLmNvbVRSQ0sAAAACAAAAMFRZRVIAAAAFAAAAMjAwN1RDT04AAAAcAAAAU0ZYIC0gQ2FydG9vbnM7IEh1bWFucyBGYXJ0Q09NTQAAAC8AAABlbmcAUm95YWx0eSBGcmVlIFNvdW5kIEVmZmVjdHMgLSBTb3VuZGRvZ3MuY29tVENPTQAAAAEAAABXWFhYAAAAGgAAAABodHRwOi8vd3d3LlNvdW5kZG9ncy5jb21URU5DAAAAAQAAAFRDT1AAAAAsAAAAKGMpIDIwMTAgU291bmRkb2dzLmNvbSwgQWxsIFJpZ2h0cyBSZXNlcnZlZFRPUEUAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/jQMAAKjyCFAGbqAD/55sgubSL//OGkGB0S1//5g7ObqY/galDIGSA0BjMS/4GQwGAMHAMCgEDFIJ/8jwbHygQQ9/+DcYZeAYAADAoEyBsY//w7IjcQQAkACfGYGh//+X0C4eNxxum////5DCIEUFrEfhzxkBz0zhOFr////8i7kgkThXIeOM+QAnCqRNA5//////5VIms3QFkE4xEyyOMrE4mdJ9AcBQIh//+7JkgSguAeCLu2222/bxzSfTcoq0vQcKSNEE9MwRUYIa2h8z/40LAGjKMesTLmGgACVIlg2y0lBsACQPEBVAcRmHOboG4W8W54egJIUGGRppyxEe5mPcvF1EcC6Zu2UDxKEsVm5MPHDiCO7cmGFjhcMyowJyzVaX2W8vn0jrsWGRgdMFGZcNTZTXQQZP7IqTL5gYGZstFZ8kTIlj7Fh0+5ugTv/+aIunRVapNK6ZmxWgokjVAoG55Rmr///TdB3QQsqmZqZjQ3SZF0TNU2UtE6hUYpO6Bd/73XZrppzEpHSfVgDWLW2U6Tkqwjo5wEEGUIAbAmf/jQsATKLQavKPPQAEHEIErl0GcCWCZBBLtTpW4kBUNQAwKTFUPkQoWEEUEYqFx0ZQfDSUGCMJDhayRUhm/hRprDk+4+1KOXiGtUaru21Q6YviLvlG7bKmUHvVrxDf0u3rcpG0X17SdpNRfLKvz03aw/DXzX7P0n/qs89V2tJejtr3NXFVW38T6rXF+0r3bP+jkw0NzBRv3UFryVxWAGzu/hlqbjleB1YG/ADVoJwS2AZTby5ZX0QHEeeEOjP2M/YPiQmxmzPNLZtcIVYL3OJsW/+NCwDQqTH6xQMPG3MUf2g6vWsW/Y4sPeffX1TFszZpjNM08DG7YruuL/dDMwlImkDUzVnMr6WaW0GKKV0XhDxAYbUuaiRx7A5tYiowpHcxqe4WAwFlJ/CGpCvVe4xkNem1Qi8ZumXMy/LqGX8rmZFvKZNjs9Ksk+lY8TzJDFJZ0SaqQC53tJjurOU0odEOeng/cEL+osqs1KqE6hNENOZxVrcxXT7LM/Y80fajSqnM8aaNisDcbNN7f49Z8uec2zEkcLQb1v9XkZNSyVtjes4r/40LATiwUWq1Aw8bd2pn0rGsgpcOelNQzhqVVVKBghrXBExHU1hC0QOUdmLGqDoFjrBJh0zP5RIoqixbimMMzIpoy1HHIWDlMyYKo0eswJIRrGrutHt903xqRI5lyZXg8Nimd+qX0vZqFEg1FJEFqkAjsep/x3M3fp2eAcGEz9JNz9w6XTE0EYAyFqNUS6tjFjAOQRTZFFkKSBdGKnZBakrqFblZ0nWig6ZMFAga0lKSdjdygdLTqT+csFZ0/UXSSWI8S16xUR8zz9VMkVPPuTf/jQsBhKItqrUDMkL/PDpvFx8K/3NY+f3nmuVRpuYH20TLLPd9DahCKuWmhvkWg3H3G+MMkLnhNg2TDYK7093eh/sDnuUztbF3Ij9hUtFWECIUdDUx/KL0rCxWBFoYcTgKxoisGlm5VCFNgF0H6QSK4mozwI7AzKUzXCG0w1IdD9kVSlNJigvq43JMrbWHFi2Kxt7e0UxpM0bP9LwcMyeP57TOsbri2ZodM78/4y0KJcIsj5QJTQFT7YfPVHJSILnJ1gjsaZk71jIHa6e7dNgVT/+NCwIIr5FqpQMPG3IUfVkcIDmFUjzOM/zlLpUv285dDLyMr1fV7CcjqyErbnKA5MvY0P+t+0FUzSMUNj71LZw7jFREDbpKgqINbSAC8149l7q0E1I3+XxYXSIEeEJPYiH7xwhpW9aYfR06nkTEirFILCwzQlE8jNbIxtWle37tK9zJqLh43woGY+t3tmm7QL21JCvWlt6tmKFDRjrHBSQdaO1NDiXUkZpZW5lVSRp0q60TmylFpcV8o8yrBTjUxM4pebmPyHD1hQzU/p1E4k1r/40LAlit0ApwC08bdRQoW9bzqOtZCp1f3G40oRtb1N2c10U1tsAhlT1cJfG617CJto3FYcgkcsowLickIwCjAFY6yVqeOh8dIh+N6EpxGlvQt4wRZ4lpkMssqPDzzxL41rV4srnFiXvql5NXxmlcYi2rrcO3rEoSHeE6PbP2PTYdEMJNqTC0AxYgxhZuCJYRgCDpTqO5vTQlc7BFI0DE51zlFowhIvpZizJhZUESELNCdw52CM4iCK7iMPPcBtABgewt7ea+iHqaT3v8uX6/+ef/jQsCsK2tqqULDxr2fMngACD/W1qs/6y3iisYfqUNILSDs7zv60SCkJZlrgA5352mfpH8ySQm3H2mEkA4km2yLDQVJJqxIDJHXEfOry1dRKbxSLPTNa5kv8bzq9K7rXe9/5p8/1xfGtfOqb+Pq2t6zq2bf3tLjOcViR74xncbVrZxbP390zW2a/GM3gYzm807hX2ewoKuVb1QqZPoidUqRExEYznS+P9qP5xSyiZy+MyTSBoxTLOthVCLUh7H0U1TjbEub6FH6pVXBcC4JVwOx/+NCwMI7ZB617Vl4AVki4Qx2zK+NR636edjhy025xHcB5JI6jZeON5WqLNDxaHDy02DzPyY8h82qvUFmPdrKWq1uGkPAcaPl6BAx1P2AnDOgFIoxgFpMiDAlMHjdwQEu0LUxx/kEpEYyJSLZmUwseOhpcEoflIKYgGei9uQ2p3kpmK+9fDctp8q+Ferd1jlzDPCWa3vO7/1tf38LdbO9d7Uz3rCzupdpuUOFPn/N/Vwx33mN6mt1Zjs39exT38rerF+7Z3uprHD8f1nU/dqYlMf/40LAmEMceqgBmcgB6C3EdW7M1WlOms52p7lLGbFStWnZqXV8N9w1TZb1resbtWl9kzjOrSwiy/8tgp73qiky4moboqSLyiL15iNQqQPzSx6IR7lJILdyxTZZWr1NKtYyqVbrTU7ytjzPeNW52UYyui1T437dzV2Wy7629445fUi1DU7/d4U1l8QcKWRqLQ5b1hEYdYALNtzUunl5q2AhILaSpSJIJ8OcYIyLB7F8ew8pxMxHueMTVTqLq2MSpNE8p6SS1rUufdSTsifqptuyCf/jQsBPLCwykAnYaAHNkno1IrbZFlLWzoorPKRRNtVV1JJJLaqpJ9JKpGgt/VSSVSU9TorRq6nqektq0f2rU7o1ostkV0WWjUmeRd0VLqSQRpKMWeYI12XZHzdEyP1oLZ7os6l0TFRWKbj8idD4UkCQXhyzjVgCtEJhoNLQoDZyUNaj0Op3iRb7jLGwC1AUIzRNmJeMBTA344XkDMqCojtMDApOQEiJFVIGyZLGi0Zsbl1Gkui7Sw5itFExQdDqTZNGgudoV06Q+bHnM6S4LNzp/+NCwGIqZIJ4osRG3NnD/byxVJSjfT/dSaT4x+zfGOtYSNDz/jNC28uKbGXTz4xqmzqJU4/V+SqTQsNqq51TqNMsqbGxuutVVIJdcUVNMlZRKeYMagq5xpajGcLMrhHRaWFwL0rX6lbENATUjtUwNhtihKaSzciDFCLGxcJFISYmrLprRJpqeRSSZF2c4ldkVpKulS0d2l21Ts9S6TLRUtmqdbWpMtVls1aT9TotUpddS10q0alMySek6kd9aS16StGyVJ6KKuldl06voIUUkkn/40LAfCmsgmgJT2gAM1ajWe7pJKSOsitBqK0W0EabKdkzF0aknqo9TutetmeizUHRrZLpKTUYtTCZ0NpwKmr/5wV+Gi5lUmv86K0DBZ3tVf8DEWRwDHmCUDMMlli8UeBhOGCBjcF+BiuF+BgKBKXTAzR8AQBwAoEQHgMAwRgqAwQgUQf/AJAwBgjBEBgpBoBgBBIBgvBEBgPAEqpX+FnQKgOAwSgyAQAEEACAMFoRB/1Kq/w2EDAyEIR0H/AwCAHAwBAjAwTALAwAgmFbf//g3v/jQsCZT3w92AGcsACgYCAGh+oY1AwKAxAMAeAECEOsAaAgLqwbJD2v///w2oDAYC0AgBYWEAYBwBACgSBYC4GBIE4W5AwBADBsyAgBYOAiBgVBgBgJA9////+AaBEDA4A8AgBYbQBQBYbkDAoBcBYBAWCDCYGAYA4BgBQ2QMDhekAoBIBIFhQwGAMBwGBMCn//////gLgABvEBgFA4M4BgHAwBglBYOQBgHA0BgtB1xRRMQU1FMy45M6qqqqqqqqqqqqqqqqqqqqqqqqqqqqqq/+NCwB8AAANIAcAAAKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=",
        "SUQzAwAAAAALClRJVDIAAABkAAAAAAAAAGQgRWZmZWN0cyAtIENvbWVkeS9DYXJ0b29uIEZBUlQgV0lUSCBTUVVFQUs6IFZlcnkgbmFycm93IGFpciBwYXNzYWdlVFBFMQAAADQAAABEb3dubG9hZCBTb3VuZCBFZmZlY3RzIC0gU291bmREb2dzIC0gQmpvcm4gTHlubmUgRlhUQUxCAAAAGQAAAGh0dHA6Ly93d3cuU291bmRkb2dzLmNvbVRSQ0sAAAACAAAAMFRZRVIAAAAFAAAAMjAwN1RDT04AAAAcAAAAU0ZYIC0gQ2FydG9vbnM7IEh1bWFucyBGYXJ0Q09NTQAAAC8AAABlbmcAUm95YWx0eSBGcmVlIFNvdW5kIEVmZmVjdHMgLSBTb3VuZGRvZ3MuY29tVENPTQAAAAEAAABXWFhYAAAAGgAAAABodHRwOi8vd3d3LlNvdW5kZG9ncy5jb21URU5DAAAAAQAAAFRDT1AAAAAsAAAAKGMpIDIwMTAgU291bmRkb2dzLmNvbSwgQWxsIFJpZ2h0cyBSZXNlcnZlZFRPUEUAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAP/jQMAAKlyCFAGQkADwxWGpeAqE/4rggB+KUGfGT/yYC6AX0ACv/xKQYwDLgXODx/+FogWEBvgWwGUHZ//g2QBgQWOC4zdMkP//xHYpclA0cBSwsrE8CwABJ///+H0IOAOYpcrgKWUjULOBggc8QT/////NjQSgIUGQGQFJixhl8VMXABoAYwMzb//////w5AOkDaBkxmAsrJQiBwnGIYRAvuQwcAgGTZE///ysSBPjJmCwuYIgyupS7LKBPHrmhLh3Jflw1KYSclRhPLiLmBH/40LAGS98gsABjWgASVHgn9aryx0Tct/MzdzMvpj3JI4ZmBl/pm6CLmBieJAsJ58ub/oqUmyJ9NMonzxPKRFKY4CX//WbqRSMGY0zQuD0NiMZlhWTzpJmpv//1MaGCzQuTA0QdR4k1lBAlSipEmj0JMkxbifEAc3+/++ZLJdFI2M0Ez60VJm61ObxqJQSRAYMsIZaxTMimRC4kTDAeBKlL/ounRSSWgSo7y0a0yQHmXC5/ZCgo8ApGJGq5AKlMijHSSJcQ80iQaqyxEiLLQUeW//jQsAfKwR61gHJQAHTITF3UlGCGC8G54cB4JBzjKEOxxs2spFW2zQ3A71v2mO2FHlBQQx4eEEGM8ouqt1uqvqr8HRyzVtL/StTxY9EgVpEYdO7PzVr06FRCtYwc6ppmWyQ0HSdiHVGKHsiGzHOw84cOLkwQomYFkvJM+avnF2jt6V4W5ciu2Kfk8a1OqXow2Ugo2vQe/Ld49j+py4RQoDIya54ScxJM0FEAZE4mWhCtAew3sa09d4t/r63vxNN4QgXUvLWrVbF+vuvjV1Wu5r3/+NCwDcszBbSIDPQ3fjGtVvitK238W9rY1m2CQF5P5nOVQ0rBzM5tPMDxih+PveUW6mrtGWJrlqGBIJjjRCHsLWsHTV2rTmu/BCdzVNrrTdG+MOGCII6OLKqFFPXDZKkoq2phDPzXxlMzcruuNPFDbJq1JopYmLQ4g8RIhtNhYmzNSxM2bjlMl2qNFhEJCEdRyPGWCAw8TrHkVvYyRUlUaRCps2dWyHXRoM7DSA7RmCqDkQQZr12SZ3Y2RaklZSbOzs70vdTpBUReHOOwchcQdP/40LARyqT9srBSWgAe9aVFJFJaksyTRSRUtS0a3r61HC8swRN3WnQZ0KlIpLUigbJpJW/W3XWy6i8bGjmB9BTHUzBjczUibMfRJIllJJVW/WzaumZDmJM4YGroGZfSQQrTZalmSZeNlQSrdK6kFqKKiQ89paILIZRi0Dto4JSjUVsTNTerXwE16PUtrdXL95Y4u4sIeLguHXaXKWpMV8IisFflK94BfWHoMkpbJcsao7F3lqZ3/Juci0WnK97msOZ3sd471zGpCkZiACgb5wBAP/jQsBgQ4RqnAGJwAFAEki9iCIsuZwb0/Wt3q27/7y2+7sQ6zJiVl/uXYy0ypar5UtXt6U2n9lMq+7v/1vPW6u6l+WTcjadALdmAuLIZDKXRdJ/rbhT977+8aCtXlUrpsPx13Wd3d3GrhrVFTOmqdDdQ1NZbpdVS14YKg9yaWVOvB7OHUl65X2h6rHcY1b5c3nyzGnrrZPtjV3v991+rOOWv/ff0/9+KQZMzUptS2rDMmq1M7mrmWrlOwoGidbFH/JStva/5cK1/IsaDf/I4tid/+NCwBYvFDpkAY+QAUo1o/HMEUAMgGx8LmlFMLpB0wrvxHpGlArHkSaNydRb+RpOi5TMsj6FJWSMklf5BBGwm4rDll4nk3Lx2kdMnZH/rHNMDcipHH2J0zJ01YypJKMj5km3/8ipsYlowLyA5qA7S8T5IGJ1KiaqWp0klrRLq//+QYzIKalMvMUzIdo5KJKkciPkmSGj4JMxRrZGuZF7MaLIl1H///K54jiKmRAjM6TApMlqMIYhOYhOYVF/EKBYWskVNWA5AVBaYHQCwfDQag3/40LAHSqj9TQBwUABg+FrJFTShZBYWskVNgoVFTaKFjiRVxUVoWFjnJFgbCzioNTSg+oWFrJFTaKDkBUFqB0AsHw0Gotf/sxQdC1ioemwLLX/rRIqK0LCx0ipzXyvDQLHWSKmwUqrs1yvK8NcrqvDN7Cx1kiqwy1//UquzNK3//+18rw0M2qrwSKitFCx0ksFYioTB0V0EVwb2kxBTUUzLjkzqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqv/jQsA2AAADSAAAAACqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq",
        "SUQzAwAAAAALClRJVDIAAABkAAAAAAAAAGQgRWZmZWN0cyAtIENvbWVkeS9DYXJ0b29uIEZBUlQsIEFJUlk6IEhlYXZ5IGV4cHVsc2lvbiB3aXRoIHBsZW50eSBvZiBhaXJUUEUxAAAANAAAAERvd25sb2FkIFNvdW5kIEVmZmVjdHMgLSBTb3VuZERvZ3MgLSBCam9ybiBMeW5uZSBGWFRBTEIAAAAZAAAAaHR0cDovL3d3dy5Tb3VuZGRvZ3MuY29tVFJDSwAAAAIAAAAwVFlFUgAAAAUAAAAyMDA3VENPTgAAABwAAABTRlggLSBDYXJ0b29uczsgSHVtYW5zIEZhcnRDT01NAAAALwAAAGVuZwBSb3lhbHR5IEZyZWUgU291bmQgRWZmZWN0cyAtIFNvdW5kZG9ncy5jb21UQ09NAAAAAQAAAFdYWFgAAAAaAAAAAGh0dHA6Ly93d3cuU291bmRkb2dzLmNvbVRFTkMAAAABAAAAVENPUAAAACwAAAAoYykgMjAxMCBTb3VuZGRvZ3MuY29tLCBBbGwgUmlnaHRzIFJlc2VydmVkVE9QRQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+NAwAArTIHoAZWgAPAxCAxT94DAHAxMNtSAABfA02U+aJwN0iAziQDRAv8DNhRFBBgGMFfs2CIAKDAyggLKBkP/wMuJEDkQFaBkQTh//gDBwuDGTNCbJ8gn//5FCcDpB1jvEeC/Efi4P///yKFQPkFkEQC6sXOOMi59Adn////5PoEDImaFoWeO8nCmRMqJy5//////6JPpjoGQFwGJuMoOAzLZACoQcvm5BC4af//k4i44yHkTL5saKt9u2225fTpNvA8RiID3biKxGRhp1f/jQsAVL7SCkMuboACcSvIHAjvmgDxogwT5gaDnB8BOgcEMAFEDTEL0iAEgXAUMAZMiDeMA4J9BaC0xCggAQ4dJe/TToLcliAF8WeRwfJ/Te900CiO8cB4oES/5xkEKlpplIiJMl8gY4x0k0h/+7IMn0ObGZEDMuFc0M0TcwNP/+99+g1N0zpWKRgXDI8T7m5UN2OFb///U39OuztvL611mCBqdQW5SPFszY3Ud/7b/YuKRQZMzSimjEYlj7qpFs18lkQoNLZmqjG0EAkc/KDQN/+NCwBoqTAa0BdpYAAK6FDYLT+XkIQq7opA9NBg0FZDGBSDaYmWgrkYstI4jBsub0jdy9rDz4cfnWnd8vthxj9DVltdxf8aEPWm5ljviNkuYtf8zzxL5972RX8z/HK8Ml8Tdzcz92/vm29xF/c1HxEMafu5pkuiZun/Ecd8/zfcvmXzNxy+K37JbcMiOI5hO2MnYclZcwg4iwcv1VcAALjklttJ8fqf3h2vuQcgux9DpVFSnLgbCJUKGML4mymdRb7Y5fEUtWOlmt0rc5iSQ40T/40LANDjMGtGee9Lchqhjebgab8w2dvtmmaP7Yq/8Ka2m9nZ3zYyv2RydR7VP9zh71iDuyci4cCk5R1cjRiNctCrgQCRSLFSSMkZfItpMakmRTfBIL2Xn5qakFGIyJEYr820b5oCc4ggwpFto4eSUQMtr6SMF2tA8GziBddvSlMEmUuu3T0ac2VHrwkgbkjiVDcygoMtAOXDc2xQDCBkVwQChSnKm4o3AOTqdtHHKQkZAQCAzyC9JMg7S9KozV4Vwh4GEiyYhhmSP1TLZ0BxEuf/jQsAUL/SCwAB7DNz6dc4ipfnKMTFofn1yo5ObH6UqmKqbWabpk2vk2vrNOldTa1X+q9uFiJf1HuaytaUdm961eKW3vdfH98bbrtFnpLpPDz6Z8I7jI5D7eWewXr6pR/JlR8Rom0Q2UpcxZVEJPyrtshBZfTQajW5LkSyj0owrXNgo7xtJRK0I2tU8UyB+J45o0sgcpXm2uiJSQU6NIM0FKuJBtuXSbL1AvJ/Zids8X8ry2z6nGPdCpnYaWlsqqRORQcRAmnkvBLVg680+78os/+NCwBgtbFrEAMIM3UNyiUPQAQhw41YowIBUlmKHmisCGYKD7FBp40VKiijTrk9TI4LXNpj3uVd9Uapx5V5u9PB8k6ZX/LlOJ+VWXrPaBjU04YXTZLRHNbI8SWelB55hdOkQm3pNr9rpOSod63fCdeYSVD7rNPaCmgm8p3j4qaL179bBdID8qB5rWfN36gi5pl95MeCEbzXhIhDMhsbt2V3Q7s+HvhBeruSlhsP9abEcZM1kLvPUNwXpDTpoSGrw7E33UZo6awN1p40dlWz/vkX/40LAJiw8Msigwwzdx7aP3mGjdaZelTmsO0QvyvW7Y7UvW1Z3YbWie7LVzMpXfpW0Xb33zp7bW+VNjMtPJKnMbdmGectNnbXuP/Mej8l0H3aHZBskqwxKJlBPCiGwUvcPqELKvxyp8fvrXfRlA09y9vLbT/tS3/I3PiIFP5Nlm52OU6sraxgLXuLx+ZN3pro909taXaNIqNUkWdkQdh2evM/IWye5SpTJRwurEGaSuzOikjbek8O5qa6SmgsJqs0hQTmsXhlIfdSTq5KltbUfk//jQsA5K2RKxADCTNzWvPV5I5+FOY2DEvHLZauEqhkITyIhnfYQbl3t+Xq9l9r7/VSgY3S8VU8hymm2TTheFv5PIM+JovPmdjm9nl9rWzOtvD3U2WP6OtElc5E2eb/sW+WWrvW5e9F1WytRy9x225asjwSqKW+Z7rKrMnEvAqFTwkqfn6B6jCWadLnjUEOkp25A4wIKGho1PQ6ldD8tkQyNHYI6EyHNQ/WGOk+3WoqzCee2WzTflJA1H4+c1pyeVQ6xDLXMxybosoYolrz3F11N/+NCwE8tA8q8AMpM3SvLY47Dt122KTxkiUWfLS8RcUii+mo4hJ0FMZdprdImt6KMbcQIklluCztMpq5Xxut6ovy/VKElYdbVSVE8yESMezEoagq7o9E80vMNxXxcM4ifjKbC2w8MQdwd0dxtk51xDm79gxgF/yRQgi2ByGAjUi8zqSkQGeOTSxsjCYVdhp1Cc+sIgVONsHjMLidTSMwmLHDirrSxirjnNyww7ZdS7c86+/br5Cw/W7le2OaWxyZmXIOpSWdpEfZ4exTSWYu0YV3/40LAXyzkIrigwwzdkj2lKy5fZR2cr1tbNeSu++77yfWz1bvjPkl1XZPt0sxj25iaCbIrnHJPkF5tUpKkKdnjtd5/835Evk3jP78azZT7UvGX773sx21jQzpjJevTOQ06Wrk25xAUD5lHmAoSzYBZI5ah6aTXkxXbZw1592vuBDTKxKkXKEq1ZGcVYp4B/LtSrqEnXcWzTEZICniNdlNnd/Fjbkd/MJt8aW1YPjVi7r70+YNcfFMWrAxiTNo0d76WOamVHqN2X7GWmyfh75mmfv/jQsBvLUumtADLzN3mtj1t7OOubaPMw/lyplmlqzcm9Zrz/GRzJ2p+RPa6d23uzPOa9wzQe/5faDp9Nnl7w7rnClrsBtIhxUmKiudFE+pWT93z1QyhpAUADcA8T3o6gBamrNoLSBgN64qmC12tTW7kRisC3J7QfIWEprB0LUE0jkoWBcorQ8VEQWbEEOR5Ird3kxw83I5qWEY2TZWoWVWIZKng+JGycpaPTVdDZZynph7zMqZQ2qGYfEj6lixhYwaMFVSUioW4pIdHMWeIizHE/+NCwH0ry5qoA1hAAdXSpj+21qikZWaor6WYngaOtCV2a7ru5lZhuL5N4wPmAjMiXG+tCBS5Q6K47j/o+j/iqgCYO8a0waGIbc8VRJKEE55sCgtGLtL+T0DJo8gKA40CR0VqA9gKghBf4isQqHYP4apiHspVaX5eo+X5SfFgSJCHkJsgrMC77Md6jn7gjz7caqVQ1gvXub21Io04LcpDHScX+FJ4LNh9L3uNE7Lu3kjNlDzvH7aOcsKMcrVmLE3W182g4qfRusDCk1ewMSwoiXP/40LAkT90NnwDmngBRZXQm6+5sfFY/e4zX+/tnS05q1iRDgrEKezp5h1HwxNfhLrEa0LWt7+4sKtPCvFzXW/+rVTBeHDAZVmyla1ywsU66c09JrGINGLGN6znds5+oOpPGnn+fS965+7Z+PjTKxwaq6zwaEwqinMvagCeCacgcYkoRBqXRj6QewMVHM+gdGGTEHhZmYROZwnSVxHYGXhiUMbEDFbUlh2B+AQAnYUELNC+RnrhxQLsRALrh8QYhFyEoRIg2p1izhZQzKJPDPDnDP/jQsBXP5ReRAOakAJo6FFE5+gQ1AjEybGaLxiQ6RUlFfx9i5RZRDhNpHFMjCidJlImS4cLzp/8ZUvG5OkPRIAMcXy4KYSJgQYvOtIpESTJ0jxlv/XGVHAgOePkVqWEDEhpFifk0cOk0TR8pIskdJ1I6aE8Xv/+TZQHMLpVLJRKxeJZGfHCYHzBEuDlGKKZ43NiKskkZpGtZoVi8in61169etdZMpk0QFSy6VTAmjFFJTmSR2o3RNRwshKhNjiLqJqqxujhZBvCHFiO0TVHKVQw/+NCwBwnu/FoAc9AARPHUzLk0RGDkPYBsC4RhBBScqwLCzEirTUM1qKt8M1yrezNyv8M3K38M1yt/xfr//6/8Xyuq7NcrquzXK6rs1yuSuwsyitquxzStyuzXK6rs1yuq7Ncrars1ytquzXK6rs1ytquzXK2q7NcrquzXK6rs1yalNCiosFyGxWzQps2LwbjTEFNRVVVTEFNRTMuOTNVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVX/40LAQQAAA0gAAAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==",
        "SUQzAwAAAAALClRJVDIAAABkAAAAAAAAAGQgRWZmZWN0cyAtIENvbWVkeS9DYXJ0b29uIEZBUlQsIEJBU0lDOiBHb29kIG9sZCwgc3RyYWlnaHQgdXAgZmFydFRQRTEAAAA0AAAARG93bmxvYWQgU291bmQgRWZmZWN0cyAtIFNvdW5kRG9ncyAtIEJqb3JuIEx5bm5lIEZYVEFMQgAAABkAAABodHRwOi8vd3d3LlNvdW5kZG9ncy5jb21UUkNLAAAAAgAAADBUWUVSAAAABQAAADIwMDdUQ09OAAAAHAAAAFNGWCAtIENhcnRvb25zOyBIdW1hbnMgRmFydENPTU0AAAAvAAAAZW5nAFJveWFsdHkgRnJlZSBTb3VuZCBFZmZlY3RzIC0gU291bmRkb2dzLmNvbVRDT00AAAABAAAAV1hYWAAAABoAAAAAaHR0cDovL3d3dy5Tb3VuZGRvZ3MuY29tVEVOQwAAAAEAAABUQ09QAAAALAAAAChjKSAyMDEwIFNvdW5kZG9ncy5jb20sIEFsbCBSaWdodHMgUmVzZXJ2ZWRUT1BFAAAAAQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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qqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqo=",
        "SUQzAwAAAAALClRJVDIAAABkAAAAAAAAAGQgRWZmZWN0cyAtIENvbWVkeS9DYXJ0b29uIEZBUlQsIFNNQUxMIDAxOiBTaG9ydCBmYXJ0LCBhbG1vc3QgY3V0ZS5UUEUxAAAANAAAAERvd25sb2FkIFNvdW5kIEVmZmVjdHMgLSBTb3VuZERvZ3MgLSBCam9ybiBMeW5uZSBGWFRBTEIAAAAZAAAAaHR0cDovL3d3dy5Tb3VuZGRvZ3MuY29tVFJDSwAAAAIAAAAwVFlFUgAAAAUAAAAyMDA3VENPTgAAABwAAABTRlggLSBDYXJ0b29uczsgSHVtYW5zIEZhcnRDT01NAAAALwAAAGVuZwBSb3lhbHR5IEZyZWUgU291bmQgRWZmZWN0cyAtIFNvdW5kZG9ncy5jb21UQ09NAAAAAQAAAFdYWFgAAAAaAAAAAGh0dHA6Ly93d3cuU291bmRkb2dzLmNvbVRFTkMAAAABAAAAVENPUAAAACwAAAAoYykgMjAxMCBTb3VuZGRvZ3MuY29tLCBBbGwgUmlnaHRzIFJlc2VydmVkVE9QRQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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8BhyC//ikgaAQMsjGdDVoWdT//w5EAQCH7CjB6IbKF1Inocn//8igWvEyRgX+UQ4QGFIkgM6Md///+KCELGockDcRSIM5RFykYTIyoZdGN/////EESIjlEGLw5RFxWpqI6E7CbRbQvkiYBdIpCEwYC//////8ipAhPIWIhYqM8OSQURzTEFNRTMuOTNVVVVVVVVVVVVVVVVVVVVVVVVVVVX/40LAHQAAA0gBwAAAVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVQ==",
        "SUQzAwAAAAALClRJVDIAAABkAAAAAAAAAGQgRWZmZWN0cyAtIENvbWVkeS9DYXJ0b29uIEZBUlQsIFNNQUxMIDAyOiBOYXJyb3csIHNob3J0LCBhbmQgc2xpZ2h0bHkgd2V0VFBFMQAAADQAAABEb3dubG9hZCBTb3VuZCBFZmZlY3RzIC0gU291bmREb2dzIC0gQmpvcm4gTHlubmUgRlhUQUxCAAAAGQAAAGh0dHA6Ly93d3cuU291bmRkb2dzLmNvbVRSQ0sAAAACAAAAMFRZRVIAAAAFAAAAMjAwN1RDT04AAAAcAAAAU0ZYIC0gQ2FydG9vbnM7IEh1bWFucyBGYXJ0Q09NTQAAAC8AAABlbmcAUm95YWx0eSBGcmVlIFNvdW5kIEVmZmVjdHMgLSBTb3VuZGRvZ3MuY29tVENPTQAAAAEAAABXWFhYAAAAGgAAAABodHRwOi8vd3d3LlNvdW5kZG9ncy5jb21URU5DAAAAAQAAAFRDT1AAAAAsAAAAKGMpIDIwMTAgU291bmRkb2dzLmNvbSwgQWxsIFJpZ2h0cyBSZXNlcnZlZFRPUEUAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA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8OARAAWlBa6FugMAgAG2QhF//+HLDGk6F6gMEhALJQ40R0A8BADAYLIgsu////AwOBAMAgABABDlQMABcZ0bwWTBxQNgoVuBEAABA4RmK9////+LEGykkAYCQMJBkR0JSC14cIBoGACBwnoG4guCSGdCzoBoOAwqDAFAF//////5cELC4hjQ+EG6o6RcJSVMQU1FMy45M1VVVVVVVVVVVVVVVVVVVVVV/+NCwBkAAANIAcAAAFVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=",
        "SUQzAwAAAAALClRJVDIAAABkAAAAAAAAAGQgRWZmZWN0cyAtIENvbWVkeS9DYXJ0b29uIEZBUlQsIFdFVDogVGlnaHRseSBzcXVlZXplZCwgd2l0aCBtb2lzdHVyZS5UUEUxAAAANAAAAERvd25sb2FkIFNvdW5kIEVmZmVjdHMgLSBTb3VuZERvZ3MgLSBCam9ybiBMeW5uZSBGWFRBTEIAAAAZAAAAaHR0cDovL3d3dy5Tb3VuZGRvZ3MuY29tVFJDSwAAAAIAAAAwVFlFUgAAAAUAAAAyMDA3VENPTgAAABwAAABTRlggLSBDYXJ0b29uczsgSHVtYW5zIEZhcnRDT01NAAAALwAAAGVuZwBSb3lhbHR5IEZyZWUgU291bmQgRWZmZWN0cyAtIFNvdW5kZG9ncy5jb21UQ09NAAAAAQAAAFdYWFgAAAAaAAAAAGh0dHA6Ly93d3cuU291bmRkb2dzLmNvbVRFTkMAAAABAAAAVENPUAAAACwAAAAoYykgMjAxMCBTb3VuZGRvZ3MuY29tLCBBbGwgUmlnaHRzIFJlc2VydmVkVE9QRQAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/+NAwAAqlIIUAZmgAP/vnSKFBv/PoYQdrv/rhnjhwfbA1BoDHBAtM/w9MG4xAMG5n/jIGhAxAcTn/+FwAYAEABCcPnJP//LAY0DpDEXORM9//+fNBS45BEBzBcg7Abx////kCGQNE0yLl4ghFhCg7B2f////jlkTPjPilxYCHlccZmQcG4AuAHgdn//////ibxAMXIMwaCE4pcuECC3wQYRQ1J8d5cYSgKAHZ//+XCck4dK54h5E1ZHh+Dnfpz5PwrD+pvrqYFCQdNSAcA9iCP/jQsAYMTSCtAGPaACBiaknQZhKC8NgcIxTcbQ5boM8aiCIkfiAJ+KAvkEerqapAeBLDIG0exRI5IC0HsPAbW/G0fDxKEwoGg0EYdpJFwaRPP+YGlRpSLiz4/jgHmOcvFIvpf/mx5N2M3YzdkykfL5LEwplRMUXDJX//N2Mzes3eZqmbqQOIGhkaImx5ZsitI9///rdRikZIpGyLn0XSZ3ZM6bnTempCs3NzCeWiyf/ptqrUyVbJppn2UwGmy8n0+OR/JZLK4VDxczRgPGIlPO//+NCwBcs7HLBQcxAAV6x2dzAiigiDiCCDhDNFw+EMSg4kFGhKLsJqcUUG5kESLtdohjkDoPoSi6vInE4ijEFBIQcYMc5i895pUiBow7HIhVuhCkwrjzRw55kbKans7WnC1pbqiu5Qx4SR57GaJn3CenzxW9RLpZEnpuUhC8nvaoNuSn0hRPvUDISUxSnmRp7t5G13CuqXoiabzfb2/FxfzrxVUsJFrLj34qDV3mWEuKr1LtXA31U3O0kXJWQ9VVw5m5xZISV9HHjlTTVJk8hCIj/40LAJzBUgsCgewzcYdPtHBYK6i8SGf8084VxLYVM6ZkdbB7xeW0qlSsNdDEeQucqSLFsK55EcNNsHL6OJYEeWLJQtNIHZVZsdXL3J2E6aagrTS+pBvhbqQ7aXaZjNc6gvcyjdpFpKdL1OFejtNQkqjVFSgcuCeEsvEwVtxaR+bKTq2prZ2TvT1LVjTMtLXLT/TtreX+vWs2PL5DovnZL1jbks8U7cqpIQP9ryFQtQ81kHoaYMDCcUuKWbyvSCHimNaiCGsZlV6uNG63laUcDtP/jQsApK4OqxUJ7DN2pKHjJk8uRNJCddY0RGsb8zcdvsZfhcfQ4S0kTMKaH7zLKNq8ag8xxW0ypwLSiiBQMy09oa73R8ml7NZmbiba/K0yM5bes6NNDv1+HY2fV6aXeP1S/dvuf9m2K1m2KaMdt1mab3W8XPeW+Rmu38Xlflmvxb1EStQcDlrGn2/qWzcqgbZkLYwIX91Lkc9gElDVB65GqOxdb6wHzKyWkhEGmUBhcKubQLrAkjLiAqWFLQBCqINMiNbCMCZk0RRMws4gQhFVo/+NCwD8qKl7B4GJMuQ5BB8oiiYazxR5SxZYoOcWkSJp0jBwsiRMOQuXZBM10Vqw5upLXPPT3b0pqp2r7G+rRfWR5goYLi3bVGQWgLi7KdAUEqKV7L1VmPwNaDk6NsSQFNZ4TH0jO1OTT9pbMGfULwUPkSWVMnR0mgAAtzWqu0ctvT9UpDPfTaMb+kE4tzdoOfceubuQQwsrLHcJy+eqLFWjbsl4/SsLzgZtnji4PcrGXim+0oWliOBatLLfMNLX4osarZ7Ul6RtXis0gcMYL17P/40LAWitkEsHkewzdhxmQaRtZCTecnkXDTl67NrbDe+9Xb189V5vb7ZvnbfK999ps7t3d2iG2P9f59fHfI3czH3fDQ2Zm/1NN+z5P9xMtB7y36O63n+NXozLg2/Ou+/KVZwCHy2lSCW+MjQBYQ02AESntmD1bXEMhEra2FjrtE7yqvnZ+r6xAWezcuU1cwdtL8RFr1EZ0dHVD5I/DS5qqVUPzJ1T6s4gRotMDrUqB0OaGQRylI3JpoHKLyEbElIbhpu/Xmu8lH47q1vdT3cx2av/jQsBwKrtqweJjDL1Pt/Wfar/SvG+Gn/e286o/v7n1q35W7RsbEmYxTo2/w2sqgQHsqBggx5HQqqnAuebrl62fzf+kcsjV9KAQCpfwFYteGxjdZexnOQZmj0nZsXhsaE5oWcAXggVZh7Cp4wUMAWDiBgigBg4hx4ekRiMC0Vc8TCYRXkTHj1gPDzloXgkoRQ7suBOHg4yRHMqoDxm2FGOzHJOyFUdBcZiSlSWiVl07uldul3SQ70jonv1UpU9pV6O/aTa1NdJM+XU1Bf3KXFuk/+NCwIkrFBbBRU9AAHURF4yZqImYiYj5iOooll0mW7eY7SHl/m2tRlZwkxal0EmFKp583Qlk5TpOqwqOtc06Q9Baa7VkpDWmZSDZJY6iJVifM4oSdIqKeA9JuNCiP5lHSPUDiOkmD0lKuQkcKiUCpNGhOEkZw7kueBLtHC55Tr97EeQ8lwQ4hp4QCSj0qqU/XNPnKon2XBuY1iITxvUJbH8E0Ft8/NFXXOVXRkSxQZp643WfagjKZw0pmVkYIqsxHP19HP1uupWKdSt2PT3vjX//40LAoEB0YqgBmHgBr7TjxPOmVdV01MPZGG8dthR21ujMLdGUrE+VrFSX4trFvb1xaqxq7JeM0WjRG5i3rFLQvEhKVifML6MwvnbXGjwYU7XSdv+K119VzqvzXdtfdf6fFPiBJPDarQ2q0vOloCoEkTi4S6IkqvAibpjBPutEo0FyhgDANyJVKAC0gxKz0I9TMlMizAtQGwnp2rBYzbozpVxDSBdl5BqiLKlDm5cpBibp/klQtZCRcS2FewrbjIon16szjd6MIqzoCpNYg5pPkv/jQsBiQUxijAOYeAGmidULKlYdWrR5MXUnBByuRJlpovhtvTRgvWW72Ey5rXW93gdXISr3BqUzc4sd2dSHSnZOxSuNcWg7fX3Bz7fP3nbgxsS7nYYEzZl+p3bJazarVbAsxVq2294WqZ9K3+8e9fijxTxmdqgvItMtr1yUC9FV7HHtCqysOHyugvXsJmfV3X5e/W9fefjec/++s78TDi34vOxwoTEzQWVlhPmLx4Pq1XixADk11twfZucVxcpszjRZ6mzsqmn2blDuqXHHlLKq/+NCwCAo+rJwA9pYAGYgXKHicCUA0CMCCTTQbTo6R8HosUldIjGyq5adKhBZ37RSXhJNzWlLnOnPNb06nNPtcxhhcS3Nl4m2+1rXbUaprFXOc59W3fW75a1J1U3uLZbWXC+60nPmW+66m4iEsaBXCXH1mCIFjwwkjKnXAJAa1yObvctTDrUPBUqnQRpLTAUH0BAgXAsNiQaeNTH4OgeJqbw1MrSU2RRwjsMXeLL5ZQg+a1orG7kSg+LBiXlXnr5qLhoJqhgUj7R8sjs2fKxIPjP/40LAQClzdlQC4wa9ieSoDCG7RBhZpVUujxcm+HlyXgoVA09sYzUIwIxAZRjUmVqJkXXXz+wzPb/zuLjMkb9O9p1S2+H3Niua+tyLP6Sln/+pE1VS1nxm+UbDiq8Xzo0I5xNth9VT3eaNa7oP3MNaOfnqBGSQdnDgOHQ0HCIfDgKU2dp2mYLflE82RFqUvzDdPYsynEo+ortQIOFmrh+x1j6F65Z0bHh0dBmWUzSCnuiCWiw7ry1+J2qHT4XHf9ddubt41ZiqRcu+t3vzYZtekP/jQsBeKxRKRKDjBt0L8cIaujDWtLYEdyRr1SITThu7x7csj4VPNSI+uUt6ob7H2iGmWRH/Tg5nNnqVdsjynd/KVsrDT6y6HNs8iaeXzY5L0nnqqawW9I1LnGxqGWs6EkZqHFbtJltKh1katDpSZ9IcmIpHJbDcTkdPnQzNWVmhMYSFjpIIxo8/arz5PJZqYQhZY1CDhS4ZLn3H0ZQUQQccYynzJ83bvfToYxjGHLfdy+ZTQhlVTKWc9893viNkHIjfb7m5ftZ10yKl83O973RD/+NCwHUqSsJEAVtYARkQynvf22X3HFLIHB/R4bpp0CStt4+Ja3gS6Xcd+xCii102esCACyO3e/OEGkNe5+lmvsxVNOMlP4MnAAHoUf5wkvpiycjJ4l/miZ/GcZnRbf+ZhFnVTpvCrVs6//MXUjaWY2FaMGM8sv3//5oSKaQlgkaMpIiIax/WW///8CEZnRyZAAhUSMjIjGwzHHWst////qNmHDZjAXIVKlfIcd461lvf////mDAaciZRgoIDgJhJdlDs/OOtd3vmtf/////qZMD/40LAj0xUPegBndgB6NnLPFypemAB65l3BcALm93vmtd3vmtf///////oKlzaeGEBSAlBUvazp6X4LymAAZhQuXO7vfNa7vfNa7vf/////////5ZYwkWZSFgExAjCoIYODGFigICzCgcwQLQFAEEMTIAQFmEAJgQaDQYwkIMNGua13e+Za7vfNa7jvmv////////////8GA5gwOYYMl5jAQYxEeCwCYABmDCOm5qG1UxBTUUzLjkzVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVf/jQsAhAAADSAHAAABVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVV"
      ]
    };

    const ogg = {
      prefix: "data:audio/ogg;base64,",
      sound: [
        "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lNJaSq3F1lqtoZTWSiqxlZJabK3V2FqMNZTSYikptZBKbK21WFtsNaaWYmyx1VhSizHGWHNLtdWUWouttVhLKzXGGGtuNeVSAADAgAMAQIAJZaDQkJUAQBQAAGAMY4xBaBRyzDkpjVLOOSclcw5CCCllzkEIIaXOOQiltNQ5B6GUlEIpKaUUWyglpdZaLAAAoMABACDABk2JxQEKDVkJAEQBACDGKMUYhMYgpRiD0BijFGMQKqUYcw5CpRRjzkHIGHPOQSkZY85BJyWEEEIppYQQQiillAIAAAocAAACbNCUWByg0JAVAUAUAABgDGIMMYYgdFI6KRGETEonpZESWgspZZZKiiXGzFqJrcTYSAmthdYyayXG0mJGrcRYYioAAOzAAQDswEIoNGQlAJAHAEAYoxRjzjlnEGLMOQghNAgx5hyEECrGnHMOQggVY845ByGEzjnnIIQQQueccxBCCKGDEEIIpZTSQQghhFJK6SCEEEIppXQQQgihlFIKAAAqcAAACLBRZHOCkaBCQ1YCAHkAAIAxSjknJaVGKcYgpBRboxRjEFJqrWIMQkqtxVgxBiGl1mLsIKTUWoy1dhBSai3GWkNKrcVYa84hpdZirDXX1FqMtebce2otxlpzzrkAANwFBwCwAxtFNicYCSo0ZCUAkAcAQCCkFGOMOYeUYowx55xDSjHGmHPOKcYYc8455xRjjDnnnHOMMeecc845xphzzjnnnHPOOeegg5A555xz0EHonHPOOQghdM455xyEEAoAACpwAAAIsFFkc4KRoEJDVgIA4QAAgDGUUkoppZRSSqijlFJKKaWUUgIhpZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoplVJKKaWUUkoppZRSSimlACDfCgcA/wcbZ1hJOiscDS40ZCUAEA4AABjDGISMOSclpYYxCKV0TkpJJTWMQSilcxJSSimD0FpqpaTSUkoZhJRiCyGVlFoKpbRWaymptZRSKCnFGktKqaXWMuckpJJaS622mDkHpaTWWmqtxRBCSrG11lJrsXVSUkmttdZabS2klFprLcbWYmwlpZZaa6nF1lpMqbUWW0stxtZiS63F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1lqtoZTWSiqxlZJabK3V2FqMNZTSYikptZBKbK21WFtsNaaWYmyx1VhSizHGWHNLtdWUWouttVhLKzXGGGtuNeVSAADAgAMAQIAJZaDQkJUAQBQAAGAMY4xBaBRyzDkpjVLOOSclcw5CCCllzkEIIaXOOQiltNQ5B6GUlEIpKaUUWyglpdZaLAAAoMABACDABk2JxQEKDVkJAEQBACDGKMUYhMYgpRiD0BijFGMQKqUYcw5CpRRjzkHIGHPOQSkZY85BJyWEEEIppYQQQiillAIAAAocAAACbNCUWByg0JAVAUAUAABgDGIMMYYgdFI6KRGETEonpZESWgspZZZKiiXGzFqJrcTYSAmthdYyayXG0mJGrcRYYioAAOzAAQDswEIoNGQlAJAHAEAYoxRjzjlnEGLMOQghNAgx5hyEECrGnHMOQggVY845ByGEzjnnIIQQQueccxBCCKGDEEIIpZTSQQghhFJK6SCEEEIppXQQQgihlFIKAAAqcAAACLBRZHOCkaBCQ1YCAHkAAIAxSjknJaVGKcYgpBRboxRjEFJqrWIMQkqtxVgxBiGl1mLsIKTUWoy1dhBSai3GWkNKrcVYa84hpdZirDXX1FqMtebce2otxlpzzrkAANwFBwCwAxtFNicYCSo0ZCUAkAcAQCCkFGOMOYeUYowx55xDSjHGmHPOKcYYc8455xRjjDnnnHOMMeecc845xphzzjnnnHPOOeegg5A555xz0EHonHPOOQghdM455xyEEAoAACpwAAAIsFFkc4KRoEJDVgIA4QAAgDGUUkoppZRSSqijlFJKKaWUUgIhpZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoppZRSSimllFJKKaWUUkoplVJKKaWUUkoppZRSSimlACDfCgcA/wcbZ1hJOiscDS40ZCUAEA4AABjDGISMOSclpYYxCKV0TkpJJTWMQSilcxJSSimD0FpqpaTSUkoZhJRiCyGVlFoKpbRWaymptZRSKCnFGktKqaXWMuckpJJaS622mDkHpaTWWmqtxRBCSrG11lJrsXVSUkmttdZabS2klFprLcbWYmwlpZZaa6nF1lpMqbUWW0stxtZiS63F2GKLMcYa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"
      ]
    };

    var commonjsGlobal = typeof globalThis !== 'undefined' ? globalThis : typeof window !== 'undefined' ? window : typeof global !== 'undefined' ? global : typeof self !== 'undefined' ? self : {};

    function createCommonjsModule(fn) {
      var module = { exports: {} };
    	return fn(module, module.exports), module.exports;
    }

    /*!
     *  howler.js v2.2.1
     *  howlerjs.com
     *
     *  (c) 2013-2020, James Simpson of GoldFire Studios
     *  goldfirestudios.com
     *
     *  MIT License
     */

    var howler = createCommonjsModule(function (module, exports) {
    (function() {

      /** Global Methods **/
      /***************************************************************************/

      /**
       * Create the global controller. All contained methods and properties apply
       * to all sounds that are currently playing or will be in the future.
       */
      var HowlerGlobal = function() {
        this.init();
      };
      HowlerGlobal.prototype = {
        /**
         * Initialize the global Howler object.
         * @return {Howler}
         */
        init: function() {
          var self = this || Howler;

          // Create a global ID counter.
          self._counter = 1000;

          // Pool of unlocked HTML5 Audio objects.
          self._html5AudioPool = [];
          self.html5PoolSize = 10;

          // Internal properties.
          self._codecs = {};
          self._howls = [];
          self._muted = false;
          self._volume = 1;
          self._canPlayEvent = 'canplaythrough';
          self._navigator = (typeof window !== 'undefined' && window.navigator) ? window.navigator : null;

          // Public properties.
          self.masterGain = null;
          self.noAudio = false;
          self.usingWebAudio = true;
          self.autoSuspend = true;
          self.ctx = null;

          // Set to false to disable the auto audio unlocker.
          self.autoUnlock = true;

          // Setup the various state values for global tracking.
          self._setup();

          return self;
        },

        /**
         * Get/set the global volume for all sounds.
         * @param  {Float} vol Volume from 0.0 to 1.0.
         * @return {Howler/Float}     Returns self or current volume.
         */
        volume: function(vol) {
          var self = this || Howler;
          vol = parseFloat(vol);

          // If we don't have an AudioContext created yet, run the setup.
          if (!self.ctx) {
            setupAudioContext();
          }

          if (typeof vol !== 'undefined' && vol >= 0 && vol <= 1) {
            self._volume = vol;

            // Don't update any of the nodes if we are muted.
            if (self._muted) {
              return self;
            }

            // When using Web Audio, we just need to adjust the master gain.
            if (self.usingWebAudio) {
              self.masterGain.gain.setValueAtTime(vol, Howler.ctx.currentTime);
            }

            // Loop through and change volume for all HTML5 audio nodes.
            for (var i=0; i<self._howls.length; i++) {
              if (!self._howls[i]._webAudio) {
                // Get all of the sounds in this Howl group.
                var ids = self._howls[i]._getSoundIds();

                // Loop through all sounds and change the volumes.
                for (var j=0; j<ids.length; j++) {
                  var sound = self._howls[i]._soundById(ids[j]);

                  if (sound && sound._node) {
                    sound._node.volume = sound._volume * vol;
                  }
                }
              }
            }

            return self;
          }

          return self._volume;
        },

        /**
         * Handle muting and unmuting globally.
         * @param  {Boolean} muted Is muted or not.
         */
        mute: function(muted) {
          var self = this || Howler;

          // If we don't have an AudioContext created yet, run the setup.
          if (!self.ctx) {
            setupAudioContext();
          }

          self._muted = muted;

          // With Web Audio, we just need to mute the master gain.
          if (self.usingWebAudio) {
            self.masterGain.gain.setValueAtTime(muted ? 0 : self._volume, Howler.ctx.currentTime);
          }

          // Loop through and mute all HTML5 Audio nodes.
          for (var i=0; i<self._howls.length; i++) {
            if (!self._howls[i]._webAudio) {
              // Get all of the sounds in this Howl group.
              var ids = self._howls[i]._getSoundIds();

              // Loop through all sounds and mark the audio node as muted.
              for (var j=0; j<ids.length; j++) {
                var sound = self._howls[i]._soundById(ids[j]);

                if (sound && sound._node) {
                  sound._node.muted = (muted) ? true : sound._muted;
                }
              }
            }
          }

          return self;
        },

        /**
         * Handle stopping all sounds globally.
         */
        stop: function() {
          var self = this || Howler;

          // Loop through all Howls and stop them.
          for (var i=0; i<self._howls.length; i++) {
            self._howls[i].stop();
          }

          return self;
        },

        /**
         * Unload and destroy all currently loaded Howl objects.
         * @return {Howler}
         */
        unload: function() {
          var self = this || Howler;

          for (var i=self._howls.length-1; i>=0; i--) {
            self._howls[i].unload();
          }

          // Create a new AudioContext to make sure it is fully reset.
          if (self.usingWebAudio && self.ctx && typeof self.ctx.close !== 'undefined') {
            self.ctx.close();
            self.ctx = null;
            setupAudioContext();
          }

          return self;
        },

        /**
         * Check for codec support of specific extension.
         * @param  {String} ext Audio file extention.
         * @return {Boolean}
         */
        codecs: function(ext) {
          return (this || Howler)._codecs[ext.replace(/^x-/, '')];
        },

        /**
         * Setup various state values for global tracking.
         * @return {Howler}
         */
        _setup: function() {
          var self = this || Howler;

          // Keeps track of the suspend/resume state of the AudioContext.
          self.state = self.ctx ? self.ctx.state || 'suspended' : 'suspended';

          // Automatically begin the 30-second suspend process
          self._autoSuspend();

          // Check if audio is available.
          if (!self.usingWebAudio) {
            // No audio is available on this system if noAudio is set to true.
            if (typeof Audio !== 'undefined') {
              try {
                var test = new Audio();

                // Check if the canplaythrough event is available.
                if (typeof test.oncanplaythrough === 'undefined') {
                  self._canPlayEvent = 'canplay';
                }
              } catch(e) {
                self.noAudio = true;
              }
            } else {
              self.noAudio = true;
            }
          }

          // Test to make sure audio isn't disabled in Internet Explorer.
          try {
            var test = new Audio();
            if (test.muted) {
              self.noAudio = true;
            }
          } catch (e) {}

          // Check for supported codecs.
          if (!self.noAudio) {
            self._setupCodecs();
          }

          return self;
        },

        /**
         * Check for browser support for various codecs and cache the results.
         * @return {Howler}
         */
        _setupCodecs: function() {
          var self = this || Howler;
          var audioTest = null;

          // Must wrap in a try/catch because IE11 in server mode throws an error.
          try {
            audioTest = (typeof Audio !== 'undefined') ? new Audio() : null;
          } catch (err) {
            return self;
          }

          if (!audioTest || typeof audioTest.canPlayType !== 'function') {
            return self;
          }

          var mpegTest = audioTest.canPlayType('audio/mpeg;').replace(/^no$/, '');

          // Opera version <33 has mixed MP3 support, so we need to check for and block it.
          var checkOpera = self._navigator && self._navigator.userAgent.match(/OPR\/([0-6].)/g);
          var isOldOpera = (checkOpera && parseInt(checkOpera[0].split('/')[1], 10) < 33);

          self._codecs = {
            mp3: !!(!isOldOpera && (mpegTest || audioTest.canPlayType('audio/mp3;').replace(/^no$/, ''))),
            mpeg: !!mpegTest,
            opus: !!audioTest.canPlayType('audio/ogg; codecs="opus"').replace(/^no$/, ''),
            ogg: !!audioTest.canPlayType('audio/ogg; codecs="vorbis"').replace(/^no$/, ''),
            oga: !!audioTest.canPlayType('audio/ogg; codecs="vorbis"').replace(/^no$/, ''),
            wav: !!(audioTest.canPlayType('audio/wav; codecs="1"') || audioTest.canPlayType('audio/wav')).replace(/^no$/, ''),
            aac: !!audioTest.canPlayType('audio/aac;').replace(/^no$/, ''),
            caf: !!audioTest.canPlayType('audio/x-caf;').replace(/^no$/, ''),
            m4a: !!(audioTest.canPlayType('audio/x-m4a;') || audioTest.canPlayType('audio/m4a;') || audioTest.canPlayType('audio/aac;')).replace(/^no$/, ''),
            m4b: !!(audioTest.canPlayType('audio/x-m4b;') || audioTest.canPlayType('audio/m4b;') || audioTest.canPlayType('audio/aac;')).replace(/^no$/, ''),
            mp4: !!(audioTest.canPlayType('audio/x-mp4;') || audioTest.canPlayType('audio/mp4;') || audioTest.canPlayType('audio/aac;')).replace(/^no$/, ''),
            weba: !!audioTest.canPlayType('audio/webm; codecs="vorbis"').replace(/^no$/, ''),
            webm: !!audioTest.canPlayType('audio/webm; codecs="vorbis"').replace(/^no$/, ''),
            dolby: !!audioTest.canPlayType('audio/mp4; codecs="ec-3"').replace(/^no$/, ''),
            flac: !!(audioTest.canPlayType('audio/x-flac;') || audioTest.canPlayType('audio/flac;')).replace(/^no$/, '')
          };

          return self;
        },

        /**
         * Some browsers/devices will only allow audio to be played after a user interaction.
         * Attempt to automatically unlock audio on the first user interaction.
         * Concept from: http://paulbakaus.com/tutorials/html5/web-audio-on-ios/
         * @return {Howler}
         */
        _unlockAudio: function() {
          var self = this || Howler;

          // Only run this if Web Audio is supported and it hasn't already been unlocked.
          if (self._audioUnlocked || !self.ctx) {
            return;
          }

          self._audioUnlocked = false;
          self.autoUnlock = false;

          // Some mobile devices/platforms have distortion issues when opening/closing tabs and/or web views.
          // Bugs in the browser (especially Mobile Safari) can cause the sampleRate to change from 44100 to 48000.
          // By calling Howler.unload(), we create a new AudioContext with the correct sampleRate.
          if (!self._mobileUnloaded && self.ctx.sampleRate !== 44100) {
            self._mobileUnloaded = true;
            self.unload();
          }

          // Scratch buffer for enabling iOS to dispose of web audio buffers correctly, as per:
          // http://stackoverflow.com/questions/24119684
          self._scratchBuffer = self.ctx.createBuffer(1, 1, 22050);

          // Call this method on touch start to create and play a buffer,
          // then check if the audio actually played to determine if
          // audio has now been unlocked on iOS, Android, etc.
          var unlock = function(e) {
            // Create a pool of unlocked HTML5 Audio objects that can
            // be used for playing sounds without user interaction. HTML5
            // Audio objects must be individually unlocked, as opposed
            // to the WebAudio API which only needs a single activation.
            // This must occur before WebAudio setup or the source.onended
            // event will not fire.
            while (self._html5AudioPool.length < self.html5PoolSize) {
              try {
                var audioNode = new Audio();

                // Mark this Audio object as unlocked to ensure it can get returned
                // to the unlocked pool when released.
                audioNode._unlocked = true;

                // Add the audio node to the pool.
                self._releaseHtml5Audio(audioNode);
              } catch (e) {
                self.noAudio = true;
                break;
              }
            }

            // Loop through any assigned audio nodes and unlock them.
            for (var i=0; i<self._howls.length; i++) {
              if (!self._howls[i]._webAudio) {
                // Get all of the sounds in this Howl group.
                var ids = self._howls[i]._getSoundIds();

                // Loop through all sounds and unlock the audio nodes.
                for (var j=0; j<ids.length; j++) {
                  var sound = self._howls[i]._soundById(ids[j]);

                  if (sound && sound._node && !sound._node._unlocked) {
                    sound._node._unlocked = true;
                    sound._node.load();
                  }
                }
              }
            }

            // Fix Android can not play in suspend state.
            self._autoResume();

            // Create an empty buffer.
            var source = self.ctx.createBufferSource();
            source.buffer = self._scratchBuffer;
            source.connect(self.ctx.destination);

            // Play the empty buffer.
            if (typeof source.start === 'undefined') {
              source.noteOn(0);
            } else {
              source.start(0);
            }

            // Calling resume() on a stack initiated by user gesture is what actually unlocks the audio on Android Chrome >= 55.
            if (typeof self.ctx.resume === 'function') {
              self.ctx.resume();
            }

            // Setup a timeout to check that we are unlocked on the next event loop.
            source.onended = function() {
              source.disconnect(0);

              // Update the unlocked state and prevent this check from happening again.
              self._audioUnlocked = true;

              // Remove the touch start listener.
              document.removeEventListener('touchstart', unlock, true);
              document.removeEventListener('touchend', unlock, true);
              document.removeEventListener('click', unlock, true);

              // Let all sounds know that audio has been unlocked.
              for (var i=0; i<self._howls.length; i++) {
                self._howls[i]._emit('unlock');
              }
            };
          };

          // Setup a touch start listener to attempt an unlock in.
          document.addEventListener('touchstart', unlock, true);
          document.addEventListener('touchend', unlock, true);
          document.addEventListener('click', unlock, true);

          return self;
        },

        /**
         * Get an unlocked HTML5 Audio object from the pool. If none are left,
         * return a new Audio object and throw a warning.
         * @return {Audio} HTML5 Audio object.
         */
        _obtainHtml5Audio: function() {
          var self = this || Howler;

          // Return the next object from the pool if one exists.
          if (self._html5AudioPool.length) {
            return self._html5AudioPool.pop();
          }

          //.Check if the audio is locked and throw a warning.
          var testPlay = new Audio().play();
          if (testPlay && typeof Promise !== 'undefined' && (testPlay instanceof Promise || typeof testPlay.then === 'function')) {
            testPlay.catch(function() {
              console.warn('HTML5 Audio pool exhausted, returning potentially locked audio object.');
            });
          }

          return new Audio();
        },

        /**
         * Return an activated HTML5 Audio object to the pool.
         * @return {Howler}
         */
        _releaseHtml5Audio: function(audio) {
          var self = this || Howler;

          // Don't add audio to the pool if we don't know if it has been unlocked.
          if (audio._unlocked) {
            self._html5AudioPool.push(audio);
          }

          return self;
        },

        /**
         * Automatically suspend the Web Audio AudioContext after no sound has played for 30 seconds.
         * This saves processing/energy and fixes various browser-specific bugs with audio getting stuck.
         * @return {Howler}
         */
        _autoSuspend: function() {
          var self = this;

          if (!self.autoSuspend || !self.ctx || typeof self.ctx.suspend === 'undefined' || !Howler.usingWebAudio) {
            return;
          }

          // Check if any sounds are playing.
          for (var i=0; i<self._howls.length; i++) {
            if (self._howls[i]._webAudio) {
              for (var j=0; j<self._howls[i]._sounds.length; j++) {
                if (!self._howls[i]._sounds[j]._paused) {
                  return self;
                }
              }
            }
          }

          if (self._suspendTimer) {
            clearTimeout(self._suspendTimer);
          }

          // If no sound has played after 30 seconds, suspend the context.
          self._suspendTimer = setTimeout(function() {
            if (!self.autoSuspend) {
              return;
            }

            self._suspendTimer = null;
            self.state = 'suspending';

            // Handle updating the state of the audio context after suspending.
            var handleSuspension = function() {
              self.state = 'suspended';

              if (self._resumeAfterSuspend) {
                delete self._resumeAfterSuspend;
                self._autoResume();
              }
            };

            // Either the state gets suspended or it is interrupted.
            // Either way, we need to update the state to suspended.
            self.ctx.suspend().then(handleSuspension, handleSuspension);
          }, 30000);

          return self;
        },

        /**
         * Automatically resume the Web Audio AudioContext when a new sound is played.
         * @return {Howler}
         */
        _autoResume: function() {
          var self = this;

          if (!self.ctx || typeof self.ctx.resume === 'undefined' || !Howler.usingWebAudio) {
            return;
          }

          if (self.state === 'running' && self.ctx.state !== 'interrupted' && self._suspendTimer) {
            clearTimeout(self._suspendTimer);
            self._suspendTimer = null;
          } else if (self.state === 'suspended' || self.state === 'running' && self.ctx.state === 'interrupted') {
            self.ctx.resume().then(function() {
              self.state = 'running';

              // Emit to all Howls that the audio has resumed.
              for (var i=0; i<self._howls.length; i++) {
                self._howls[i]._emit('resume');
              }
            });

            if (self._suspendTimer) {
              clearTimeout(self._suspendTimer);
              self._suspendTimer = null;
            }
          } else if (self.state === 'suspending') {
            self._resumeAfterSuspend = true;
          }

          return self;
        }
      };

      // Setup the global audio controller.
      var Howler = new HowlerGlobal();

      /** Group Methods **/
      /***************************************************************************/

      /**
       * Create an audio group controller.
       * @param {Object} o Passed in properties for this group.
       */
      var Howl = function(o) {
        var self = this;

        // Throw an error if no source is provided.
        if (!o.src || o.src.length === 0) {
          console.error('An array of source files must be passed with any new Howl.');
          return;
        }

        self.init(o);
      };
      Howl.prototype = {
        /**
         * Initialize a new Howl group object.
         * @param  {Object} o Passed in properties for this group.
         * @return {Howl}
         */
        init: function(o) {
          var self = this;

          // If we don't have an AudioContext created yet, run the setup.
          if (!Howler.ctx) {
            setupAudioContext();
          }

          // Setup user-defined default properties.
          self._autoplay = o.autoplay || false;
          self._format = (typeof o.format !== 'string') ? o.format : [o.format];
          self._html5 = o.html5 || false;
          self._muted = o.mute || false;
          self._loop = o.loop || false;
          self._pool = o.pool || 5;
          self._preload = (typeof o.preload === 'boolean' || o.preload === 'metadata') ? o.preload : true;
          self._rate = o.rate || 1;
          self._sprite = o.sprite || {};
          self._src = (typeof o.src !== 'string') ? o.src : [o.src];
          self._volume = o.volume !== undefined ? o.volume : 1;
          self._xhr = {
            method: o.xhr && o.xhr.method ? o.xhr.method : 'GET',
            headers: o.xhr && o.xhr.headers ? o.xhr.headers : null,
            withCredentials: o.xhr && o.xhr.withCredentials ? o.xhr.withCredentials : false,
          };

          // Setup all other default properties.
          self._duration = 0;
          self._state = 'unloaded';
          self._sounds = [];
          self._endTimers = {};
          self._queue = [];
          self._playLock = false;

          // Setup event listeners.
          self._onend = o.onend ? [{fn: o.onend}] : [];
          self._onfade = o.onfade ? [{fn: o.onfade}] : [];
          self._onload = o.onload ? [{fn: o.onload}] : [];
          self._onloaderror = o.onloaderror ? [{fn: o.onloaderror}] : [];
          self._onplayerror = o.onplayerror ? [{fn: o.onplayerror}] : [];
          self._onpause = o.onpause ? [{fn: o.onpause}] : [];
          self._onplay = o.onplay ? [{fn: o.onplay}] : [];
          self._onstop = o.onstop ? [{fn: o.onstop}] : [];
          self._onmute = o.onmute ? [{fn: o.onmute}] : [];
          self._onvolume = o.onvolume ? [{fn: o.onvolume}] : [];
          self._onrate = o.onrate ? [{fn: o.onrate}] : [];
          self._onseek = o.onseek ? [{fn: o.onseek}] : [];
          self._onunlock = o.onunlock ? [{fn: o.onunlock}] : [];
          self._onresume = [];

          // Web Audio or HTML5 Audio?
          self._webAudio = Howler.usingWebAudio && !self._html5;

          // Automatically try to enable audio.
          if (typeof Howler.ctx !== 'undefined' && Howler.ctx && Howler.autoUnlock) {
            Howler._unlockAudio();
          }

          // Keep track of this Howl group in the global controller.
          Howler._howls.push(self);

          // If they selected autoplay, add a play event to the load queue.
          if (self._autoplay) {
            self._queue.push({
              event: 'play',
              action: function() {
                self.play();
              }
            });
          }

          // Load the source file unless otherwise specified.
          if (self._preload && self._preload !== 'none') {
            self.load();
          }

          return self;
        },

        /**
         * Load the audio file.
         * @return {Howler}
         */
        load: function() {
          var self = this;
          var url = null;

          // If no audio is available, quit immediately.
          if (Howler.noAudio) {
            self._emit('loaderror', null, 'No audio support.');
            return;
          }

          // Make sure our source is in an array.
          if (typeof self._src === 'string') {
            self._src = [self._src];
          }

          // Loop through the sources and pick the first one that is compatible.
          for (var i=0; i<self._src.length; i++) {
            var ext, str;

            if (self._format && self._format[i]) {
              // If an extension was specified, use that instead.
              ext = self._format[i];
            } else {
              // Make sure the source is a string.
              str = self._src[i];
              if (typeof str !== 'string') {
                self._emit('loaderror', null, 'Non-string found in selected audio sources - ignoring.');
                continue;
              }

              // Extract the file extension from the URL or base64 data URI.
              ext = /^data:audio\/([^;,]+);/i.exec(str);
              if (!ext) {
                ext = /\.([^.]+)$/.exec(str.split('?', 1)[0]);
              }

              if (ext) {
                ext = ext[1].toLowerCase();
              }
            }

            // Log a warning if no extension was found.
            if (!ext) {
              console.warn('No file extension was found. Consider using the "format" property or specify an extension.');
            }

            // Check if this extension is available.
            if (ext && Howler.codecs(ext)) {
              url = self._src[i];
              break;
            }
          }

          if (!url) {
            self._emit('loaderror', null, 'No codec support for selected audio sources.');
            return;
          }

          self._src = url;
          self._state = 'loading';

          // If the hosting page is HTTPS and the source isn't,
          // drop down to HTML5 Audio to avoid Mixed Content errors.
          if (window.location.protocol === 'https:' && url.slice(0, 5) === 'http:') {
            self._html5 = true;
            self._webAudio = false;
          }

          // Create a new sound object and add it to the pool.
          new Sound(self);

          // Load and decode the audio data for playback.
          if (self._webAudio) {
            loadBuffer(self);
          }

          return self;
        },

        /**
         * Play a sound or resume previous playback.
         * @param  {String/Number} sprite   Sprite name for sprite playback or sound id to continue previous.
         * @param  {Boolean} internal Internal Use: true prevents event firing.
         * @return {Number}          Sound ID.
         */
        play: function(sprite, internal) {
          var self = this;
          var id = null;

          // Determine if a sprite, sound id or nothing was passed
          if (typeof sprite === 'number') {
            id = sprite;
            sprite = null;
          } else if (typeof sprite === 'string' && self._state === 'loaded' && !self._sprite[sprite]) {
            // If the passed sprite doesn't exist, do nothing.
            return null;
          } else if (typeof sprite === 'undefined') {
            // Use the default sound sprite (plays the full audio length).
            sprite = '__default';

            // Check if there is a single paused sound that isn't ended.
            // If there is, play that sound. If not, continue as usual.
            if (!self._playLock) {
              var num = 0;
              for (var i=0; i<self._sounds.length; i++) {
                if (self._sounds[i]._paused && !self._sounds[i]._ended) {
                  num++;
                  id = self._sounds[i]._id;
                }
              }

              if (num === 1) {
                sprite = null;
              } else {
                id = null;
              }
            }
          }

          // Get the selected node, or get one from the pool.
          var sound = id ? self._soundById(id) : self._inactiveSound();

          // If the sound doesn't exist, do nothing.
          if (!sound) {
            return null;
          }

          // Select the sprite definition.
          if (id && !sprite) {
            sprite = sound._sprite || '__default';
          }

          // If the sound hasn't loaded, we must wait to get the audio's duration.
          // We also need to wait to make sure we don't run into race conditions with
          // the order of function calls.
          if (self._state !== 'loaded') {
            // Set the sprite value on this sound.
            sound._sprite = sprite;

            // Mark this sound as not ended in case another sound is played before this one loads.
            sound._ended = false;

            // Add the sound to the queue to be played on load.
            var soundId = sound._id;
            self._queue.push({
              event: 'play',
              action: function() {
                self.play(soundId);
              }
            });

            return soundId;
          }

          // Don't play the sound if an id was passed and it is already playing.
          if (id && !sound._paused) {
            // Trigger the play event, in order to keep iterating through queue.
            if (!internal) {
              self._loadQueue('play');
            }

            return sound._id;
          }

          // Make sure the AudioContext isn't suspended, and resume it if it is.
          if (self._webAudio) {
            Howler._autoResume();
          }

          // Determine how long to play for and where to start playing.
          var seek = Math.max(0, sound._seek > 0 ? sound._seek : self._sprite[sprite][0] / 1000);
          var duration = Math.max(0, ((self._sprite[sprite][0] + self._sprite[sprite][1]) / 1000) - seek);
          var timeout = (duration * 1000) / Math.abs(sound._rate);
          var start = self._sprite[sprite][0] / 1000;
          var stop = (self._sprite[sprite][0] + self._sprite[sprite][1]) / 1000;
          sound._sprite = sprite;

          // Mark the sound as ended instantly so that this async playback
          // doesn't get grabbed by another call to play while this one waits to start.
          sound._ended = false;

          // Update the parameters of the sound.
          var setParams = function() {
            sound._paused = false;
            sound._seek = seek;
            sound._start = start;
            sound._stop = stop;
            sound._loop = !!(sound._loop || self._sprite[sprite][2]);
          };

          // End the sound instantly if seek is at the end.
          if (seek >= stop) {
            self._ended(sound);
            return;
          }

          // Begin the actual playback.
          var node = sound._node;
          if (self._webAudio) {
            // Fire this when the sound is ready to play to begin Web Audio playback.
            var playWebAudio = function() {
              self._playLock = false;
              setParams();
              self._refreshBuffer(sound);

              // Setup the playback params.
              var vol = (sound._muted || self._muted) ? 0 : sound._volume;
              node.gain.setValueAtTime(vol, Howler.ctx.currentTime);
              sound._playStart = Howler.ctx.currentTime;

              // Play the sound using the supported method.
              if (typeof node.bufferSource.start === 'undefined') {
                sound._loop ? node.bufferSource.noteGrainOn(0, seek, 86400) : node.bufferSource.noteGrainOn(0, seek, duration);
              } else {
                sound._loop ? node.bufferSource.start(0, seek, 86400) : node.bufferSource.start(0, seek, duration);
              }

              // Start a new timer if none is present.
              if (timeout !== Infinity) {
                self._endTimers[sound._id] = setTimeout(self._ended.bind(self, sound), timeout);
              }

              if (!internal) {
                setTimeout(function() {
                  self._emit('play', sound._id);
                  self._loadQueue();
                }, 0);
              }
            };

            if (Howler.state === 'running' && Howler.ctx.state !== 'interrupted') {
              playWebAudio();
            } else {
              self._playLock = true;

              // Wait for the audio context to resume before playing.
              self.once('resume', playWebAudio);

              // Cancel the end timer.
              self._clearTimer(sound._id);
            }
          } else {
            // Fire this when the sound is ready to play to begin HTML5 Audio playback.
            var playHtml5 = function() {
              node.currentTime = seek;
              node.muted = sound._muted || self._muted || Howler._muted || node.muted;
              node.volume = sound._volume * Howler.volume();
              node.playbackRate = sound._rate;

              // Some browsers will throw an error if this is called without user interaction.
              try {
                var play = node.play();

                // Support older browsers that don't support promises, and thus don't have this issue.
                if (play && typeof Promise !== 'undefined' && (play instanceof Promise || typeof play.then === 'function')) {
                  // Implements a lock to prevent DOMException: The play() request was interrupted by a call to pause().
                  self._playLock = true;

                  // Set param values immediately.
                  setParams();

                  // Releases the lock and executes queued actions.
                  play
                    .then(function() {
                      self._playLock = false;
                      node._unlocked = true;
                      if (!internal) {
                        self._emit('play', sound._id);
                        self._loadQueue();
                      }
                    })
                    .catch(function() {
                      self._playLock = false;
                      self._emit('playerror', sound._id, 'Playback was unable to start. This is most commonly an issue ' +
                        'on mobile devices and Chrome where playback was not within a user interaction.');

                      // Reset the ended and paused values.
                      sound._ended = true;
                      sound._paused = true;
                    });
                } else if (!internal) {
                  self._playLock = false;
                  setParams();
                  self._emit('play', sound._id);
                  self._loadQueue();
                }

                // Setting rate before playing won't work in IE, so we set it again here.
                node.playbackRate = sound._rate;

                // If the node is still paused, then we can assume there was a playback issue.
                if (node.paused) {
                  self._emit('playerror', sound._id, 'Playback was unable to start. This is most commonly an issue ' +
                    'on mobile devices and Chrome where playback was not within a user interaction.');
                  return;
                }

                // Setup the end timer on sprites or listen for the ended event.
                if (sprite !== '__default' || sound._loop) {
                  self._endTimers[sound._id] = setTimeout(self._ended.bind(self, sound), timeout);
                } else {
                  self._endTimers[sound._id] = function() {
                    // Fire ended on this audio node.
                    self._ended(sound);

                    // Clear this listener.
                    node.removeEventListener('ended', self._endTimers[sound._id], false);
                  };
                  node.addEventListener('ended', self._endTimers[sound._id], false);
                }
              } catch (err) {
                self._emit('playerror', sound._id, err);
              }
            };

            // If this is streaming audio, make sure the src is set and load again.
            if (node.src === 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA') {
              node.src = self._src;
              node.load();
            }

            // Play immediately if ready, or wait for the 'canplaythrough'e vent.
            var loadedNoReadyState = (window && window.ejecta) || (!node.readyState && Howler._navigator.isCocoonJS);
            if (node.readyState >= 3 || loadedNoReadyState) {
              playHtml5();
            } else {
              self._playLock = true;

              var listener = function() {
                // Begin playback.
                playHtml5();

                // Clear this listener.
                node.removeEventListener(Howler._canPlayEvent, listener, false);
              };
              node.addEventListener(Howler._canPlayEvent, listener, false);

              // Cancel the end timer.
              self._clearTimer(sound._id);
            }
          }

          return sound._id;
        },

        /**
         * Pause playback and save current position.
         * @param  {Number} id The sound ID (empty to pause all in group).
         * @return {Howl}
         */
        pause: function(id) {
          var self = this;

          // If the sound hasn't loaded or a play() promise is pending, add it to the load queue to pause when capable.
          if (self._state !== 'loaded' || self._playLock) {
            self._queue.push({
              event: 'pause',
              action: function() {
                self.pause(id);
              }
            });

            return self;
          }

          // If no id is passed, get all ID's to be paused.
          var ids = self._getSoundIds(id);

          for (var i=0; i<ids.length; i++) {
            // Clear the end timer.
            self._clearTimer(ids[i]);

            // Get the sound.
            var sound = self._soundById(ids[i]);

            if (sound && !sound._paused) {
              // Reset the seek position.
              sound._seek = self.seek(ids[i]);
              sound._rateSeek = 0;
              sound._paused = true;

              // Stop currently running fades.
              self._stopFade(ids[i]);

              if (sound._node) {
                if (self._webAudio) {
                  // Make sure the sound has been created.
                  if (!sound._node.bufferSource) {
                    continue;
                  }

                  if (typeof sound._node.bufferSource.stop === 'undefined') {
                    sound._node.bufferSource.noteOff(0);
                  } else {
                    sound._node.bufferSource.stop(0);
                  }

                  // Clean up the buffer source.
                  self._cleanBuffer(sound._node);
                } else if (!isNaN(sound._node.duration) || sound._node.duration === Infinity) {
                  sound._node.pause();
                }
              }
            }

            // Fire the pause event, unless `true` is passed as the 2nd argument.
            if (!arguments[1]) {
              self._emit('pause', sound ? sound._id : null);
            }
          }

          return self;
        },

        /**
         * Stop playback and reset to start.
         * @param  {Number} id The sound ID (empty to stop all in group).
         * @param  {Boolean} internal Internal Use: true prevents event firing.
         * @return {Howl}
         */
        stop: function(id, internal) {
          var self = this;

          // If the sound hasn't loaded, add it to the load queue to stop when capable.
          if (self._state !== 'loaded' || self._playLock) {
            self._queue.push({
              event: 'stop',
              action: function() {
                self.stop(id);
              }
            });

            return self;
          }

          // If no id is passed, get all ID's to be stopped.
          var ids = self._getSoundIds(id);

          for (var i=0; i<ids.length; i++) {
            // Clear the end timer.
            self._clearTimer(ids[i]);

            // Get the sound.
            var sound = self._soundById(ids[i]);

            if (sound) {
              // Reset the seek position.
              sound._seek = sound._start || 0;
              sound._rateSeek = 0;
              sound._paused = true;
              sound._ended = true;

              // Stop currently running fades.
              self._stopFade(ids[i]);

              if (sound._node) {
                if (self._webAudio) {
                  // Make sure the sound's AudioBufferSourceNode has been created.
                  if (sound._node.bufferSource) {
                    if (typeof sound._node.bufferSource.stop === 'undefined') {
                      sound._node.bufferSource.noteOff(0);
                    } else {
                      sound._node.bufferSource.stop(0);
                    }

                    // Clean up the buffer source.
                    self._cleanBuffer(sound._node);
                  }
                } else if (!isNaN(sound._node.duration) || sound._node.duration === Infinity) {
                  sound._node.currentTime = sound._start || 0;
                  sound._node.pause();

                  // If this is a live stream, stop download once the audio is stopped.
                  if (sound._node.duration === Infinity) {
                    self._clearSound(sound._node);
                  }
                }
              }

              if (!internal) {
                self._emit('stop', sound._id);
              }
            }
          }

          return self;
        },

        /**
         * Mute/unmute a single sound or all sounds in this Howl group.
         * @param  {Boolean} muted Set to true to mute and false to unmute.
         * @param  {Number} id    The sound ID to update (omit to mute/unmute all).
         * @return {Howl}
         */
        mute: function(muted, id) {
          var self = this;

          // If the sound hasn't loaded, add it to the load queue to mute when capable.
          if (self._state !== 'loaded'|| self._playLock) {
            self._queue.push({
              event: 'mute',
              action: function() {
                self.mute(muted, id);
              }
            });

            return self;
          }

          // If applying mute/unmute to all sounds, update the group's value.
          if (typeof id === 'undefined') {
            if (typeof muted === 'boolean') {
              self._muted = muted;
            } else {
              return self._muted;
            }
          }

          // If no id is passed, get all ID's to be muted.
          var ids = self._getSoundIds(id);

          for (var i=0; i<ids.length; i++) {
            // Get the sound.
            var sound = self._soundById(ids[i]);

            if (sound) {
              sound._muted = muted;

              // Cancel active fade and set the volume to the end value.
              if (sound._interval) {
                self._stopFade(sound._id);
              }

              if (self._webAudio && sound._node) {
                sound._node.gain.setValueAtTime(muted ? 0 : sound._volume, Howler.ctx.currentTime);
              } else if (sound._node) {
                sound._node.muted = Howler._muted ? true : muted;
              }

              self._emit('mute', sound._id);
            }
          }

          return self;
        },

        /**
         * Get/set the volume of this sound or of the Howl group. This method can optionally take 0, 1 or 2 arguments.
         *   volume() -> Returns the group's volume value.
         *   volume(id) -> Returns the sound id's current volume.
         *   volume(vol) -> Sets the volume of all sounds in this Howl group.
         *   volume(vol, id) -> Sets the volume of passed sound id.
         * @return {Howl/Number} Returns self or current volume.
         */
        volume: function() {
          var self = this;
          var args = arguments;
          var vol, id;

          // Determine the values based on arguments.
          if (args.length === 0) {
            // Return the value of the groups' volume.
            return self._volume;
          } else if (args.length === 1 || args.length === 2 && typeof args[1] === 'undefined') {
            // First check if this is an ID, and if not, assume it is a new volume.
            var ids = self._getSoundIds();
            var index = ids.indexOf(args[0]);
            if (index >= 0) {
              id = parseInt(args[0], 10);
            } else {
              vol = parseFloat(args[0]);
            }
          } else if (args.length >= 2) {
            vol = parseFloat(args[0]);
            id = parseInt(args[1], 10);
          }

          // Update the volume or return the current volume.
          var sound;
          if (typeof vol !== 'undefined' && vol >= 0 && vol <= 1) {
            // If the sound hasn't loaded, add it to the load queue to change volume when capable.
            if (self._state !== 'loaded'|| self._playLock) {
              self._queue.push({
                event: 'volume',
                action: function() {
                  self.volume.apply(self, args);
                }
              });

              return self;
            }

            // Set the group volume.
            if (typeof id === 'undefined') {
              self._volume = vol;
            }

            // Update one or all volumes.
            id = self._getSoundIds(id);
            for (var i=0; i<id.length; i++) {
              // Get the sound.
              sound = self._soundById(id[i]);

              if (sound) {
                sound._volume = vol;

                // Stop currently running fades.
                if (!args[2]) {
                  self._stopFade(id[i]);
                }

                if (self._webAudio && sound._node && !sound._muted) {
                  sound._node.gain.setValueAtTime(vol, Howler.ctx.currentTime);
                } else if (sound._node && !sound._muted) {
                  sound._node.volume = vol * Howler.volume();
                }

                self._emit('volume', sound._id);
              }
            }
          } else {
            sound = id ? self._soundById(id) : self._sounds[0];
            return sound ? sound._volume : 0;
          }

          return self;
        },

        /**
         * Fade a currently playing sound between two volumes (if no id is passed, all sounds will fade).
         * @param  {Number} from The value to fade from (0.0 to 1.0).
         * @param  {Number} to   The volume to fade to (0.0 to 1.0).
         * @param  {Number} len  Time in milliseconds to fade.
         * @param  {Number} id   The sound id (omit to fade all sounds).
         * @return {Howl}
         */
        fade: function(from, to, len, id) {
          var self = this;

          // If the sound hasn't loaded, add it to the load queue to fade when capable.
          if (self._state !== 'loaded' || self._playLock) {
            self._queue.push({
              event: 'fade',
              action: function() {
                self.fade(from, to, len, id);
              }
            });

            return self;
          }

          // Make sure the to/from/len values are numbers.
          from = Math.min(Math.max(0, parseFloat(from)), 1);
          to = Math.min(Math.max(0, parseFloat(to)), 1);
          len = parseFloat(len);

          // Set the volume to the start position.
          self.volume(from, id);

          // Fade the volume of one or all sounds.
          var ids = self._getSoundIds(id);
          for (var i=0; i<ids.length; i++) {
            // Get the sound.
            var sound = self._soundById(ids[i]);

            // Create a linear fade or fall back to timeouts with HTML5 Audio.
            if (sound) {
              // Stop the previous fade if no sprite is being used (otherwise, volume handles this).
              if (!id) {
                self._stopFade(ids[i]);
              }

              // If we are using Web Audio, let the native methods do the actual fade.
              if (self._webAudio && !sound._muted) {
                var currentTime = Howler.ctx.currentTime;
                var end = currentTime + (len / 1000);
                sound._volume = from;
                sound._node.gain.setValueAtTime(from, currentTime);
                sound._node.gain.linearRampToValueAtTime(to, end);
              }

              self._startFadeInterval(sound, from, to, len, ids[i], typeof id === 'undefined');
            }
          }

          return self;
        },

        /**
         * Starts the internal interval to fade a sound.
         * @param  {Object} sound Reference to sound to fade.
         * @param  {Number} from The value to fade from (0.0 to 1.0).
         * @param  {Number} to   The volume to fade to (0.0 to 1.0).
         * @param  {Number} len  Time in milliseconds to fade.
         * @param  {Number} id   The sound id to fade.
         * @param  {Boolean} isGroup   If true, set the volume on the group.
         */
        _startFadeInterval: function(sound, from, to, len, id, isGroup) {
          var self = this;
          var vol = from;
          var diff = to - from;
          var steps = Math.abs(diff / 0.01);
          var stepLen = Math.max(4, (steps > 0) ? len / steps : len);
          var lastTick = Date.now();

          // Store the value being faded to.
          sound._fadeTo = to;

          // Update the volume value on each interval tick.
          sound._interval = setInterval(function() {
            // Update the volume based on the time since the last tick.
            var tick = (Date.now() - lastTick) / len;
            lastTick = Date.now();
            vol += diff * tick;

            // Round to within 2 decimal points.
            vol = Math.round(vol * 100) / 100;

            // Make sure the volume is in the right bounds.
            if (diff < 0) {
              vol = Math.max(to, vol);
            } else {
              vol = Math.min(to, vol);
            }

            // Change the volume.
            if (self._webAudio) {
              sound._volume = vol;
            } else {
              self.volume(vol, sound._id, true);
            }

            // Set the group's volume.
            if (isGroup) {
              self._volume = vol;
            }

            // When the fade is complete, stop it and fire event.
            if ((to < from && vol <= to) || (to > from && vol >= to)) {
              clearInterval(sound._interval);
              sound._interval = null;
              sound._fadeTo = null;
              self.volume(to, sound._id);
              self._emit('fade', sound._id);
            }
          }, stepLen);
        },

        /**
         * Internal method that stops the currently playing fade when
         * a new fade starts, volume is changed or the sound is stopped.
         * @param  {Number} id The sound id.
         * @return {Howl}
         */
        _stopFade: function(id) {
          var self = this;
          var sound = self._soundById(id);

          if (sound && sound._interval) {
            if (self._webAudio) {
              sound._node.gain.cancelScheduledValues(Howler.ctx.currentTime);
            }

            clearInterval(sound._interval);
            sound._interval = null;
            self.volume(sound._fadeTo, id);
            sound._fadeTo = null;
            self._emit('fade', id);
          }

          return self;
        },

        /**
         * Get/set the loop parameter on a sound. This method can optionally take 0, 1 or 2 arguments.
         *   loop() -> Returns the group's loop value.
         *   loop(id) -> Returns the sound id's loop value.
         *   loop(loop) -> Sets the loop value for all sounds in this Howl group.
         *   loop(loop, id) -> Sets the loop value of passed sound id.
         * @return {Howl/Boolean} Returns self or current loop value.
         */
        loop: function() {
          var self = this;
          var args = arguments;
          var loop, id, sound;

          // Determine the values for loop and id.
          if (args.length === 0) {
            // Return the grou's loop value.
            return self._loop;
          } else if (args.length === 1) {
            if (typeof args[0] === 'boolean') {
              loop = args[0];
              self._loop = loop;
            } else {
              // Return this sound's loop value.
              sound = self._soundById(parseInt(args[0], 10));
              return sound ? sound._loop : false;
            }
          } else if (args.length === 2) {
            loop = args[0];
            id = parseInt(args[1], 10);
          }

          // If no id is passed, get all ID's to be looped.
          var ids = self._getSoundIds(id);
          for (var i=0; i<ids.length; i++) {
            sound = self._soundById(ids[i]);

            if (sound) {
              sound._loop = loop;
              if (self._webAudio && sound._node && sound._node.bufferSource) {
                sound._node.bufferSource.loop = loop;
                if (loop) {
                  sound._node.bufferSource.loopStart = sound._start || 0;
                  sound._node.bufferSource.loopEnd = sound._stop;
                }
              }
            }
          }

          return self;
        },

        /**
         * Get/set the playback rate of a sound. This method can optionally take 0, 1 or 2 arguments.
         *   rate() -> Returns the first sound node's current playback rate.
         *   rate(id) -> Returns the sound id's current playback rate.
         *   rate(rate) -> Sets the playback rate of all sounds in this Howl group.
         *   rate(rate, id) -> Sets the playback rate of passed sound id.
         * @return {Howl/Number} Returns self or the current playback rate.
         */
        rate: function() {
          var self = this;
          var args = arguments;
          var rate, id;

          // Determine the values based on arguments.
          if (args.length === 0) {
            // We will simply return the current rate of the first node.
            id = self._sounds[0]._id;
          } else if (args.length === 1) {
            // First check if this is an ID, and if not, assume it is a new rate value.
            var ids = self._getSoundIds();
            var index = ids.indexOf(args[0]);
            if (index >= 0) {
              id = parseInt(args[0], 10);
            } else {
              rate = parseFloat(args[0]);
            }
          } else if (args.length === 2) {
            rate = parseFloat(args[0]);
            id = parseInt(args[1], 10);
          }

          // Update the playback rate or return the current value.
          var sound;
          if (typeof rate === 'number') {
            // If the sound hasn't loaded, add it to the load queue to change playback rate when capable.
            if (self._state !== 'loaded' || self._playLock) {
              self._queue.push({
                event: 'rate',
                action: function() {
                  self.rate.apply(self, args);
                }
              });

              return self;
            }

            // Set the group rate.
            if (typeof id === 'undefined') {
              self._rate = rate;
            }

            // Update one or all volumes.
            id = self._getSoundIds(id);
            for (var i=0; i<id.length; i++) {
              // Get the sound.
              sound = self._soundById(id[i]);

              if (sound) {
                // Keep track of our position when the rate changed and update the playback
                // start position so we can properly adjust the seek position for time elapsed.
                if (self.playing(id[i])) {
                  sound._rateSeek = self.seek(id[i]);
                  sound._playStart = self._webAudio ? Howler.ctx.currentTime : sound._playStart;
                }
                sound._rate = rate;

                // Change the playback rate.
                if (self._webAudio && sound._node && sound._node.bufferSource) {
                  sound._node.bufferSource.playbackRate.setValueAtTime(rate, Howler.ctx.currentTime);
                } else if (sound._node) {
                  sound._node.playbackRate = rate;
                }

                // Reset the timers.
                var seek = self.seek(id[i]);
                var duration = ((self._sprite[sound._sprite][0] + self._sprite[sound._sprite][1]) / 1000) - seek;
                var timeout = (duration * 1000) / Math.abs(sound._rate);

                // Start a new end timer if sound is already playing.
                if (self._endTimers[id[i]] || !sound._paused) {
                  self._clearTimer(id[i]);
                  self._endTimers[id[i]] = setTimeout(self._ended.bind(self, sound), timeout);
                }

                self._emit('rate', sound._id);
              }
            }
          } else {
            sound = self._soundById(id);
            return sound ? sound._rate : self._rate;
          }

          return self;
        },

        /**
         * Get/set the seek position of a sound. This method can optionally take 0, 1 or 2 arguments.
         *   seek() -> Returns the first sound node's current seek position.
         *   seek(id) -> Returns the sound id's current seek position.
         *   seek(seek) -> Sets the seek position of the first sound node.
         *   seek(seek, id) -> Sets the seek position of passed sound id.
         * @return {Howl/Number} Returns self or the current seek position.
         */
        seek: function() {
          var self = this;
          var args = arguments;
          var seek, id;

          // Determine the values based on arguments.
          if (args.length === 0) {
            // We will simply return the current position of the first node.
            id = self._sounds[0]._id;
          } else if (args.length === 1) {
            // First check if this is an ID, and if not, assume it is a new seek position.
            var ids = self._getSoundIds();
            var index = ids.indexOf(args[0]);
            if (index >= 0) {
              id = parseInt(args[0], 10);
            } else if (self._sounds.length) {
              id = self._sounds[0]._id;
              seek = parseFloat(args[0]);
            }
          } else if (args.length === 2) {
            seek = parseFloat(args[0]);
            id = parseInt(args[1], 10);
          }

          // If there is no ID, bail out.
          if (typeof id === 'undefined') {
            return self;
          }

          // If the sound hasn't loaded, add it to the load queue to seek when capable.
          if (typeof seek === 'number' && (self._state !== 'loaded' || self._playLock)) {
            self._queue.push({
              event: 'seek',
              action: function() {
                self.seek.apply(self, args);
              }
            });

            return self;
          }

          // Get the sound.
          var sound = self._soundById(id);

          if (sound) {
            if (typeof seek === 'number' && seek >= 0) {
              // Pause the sound and update position for restarting playback.
              var playing = self.playing(id);
              if (playing) {
                self.pause(id, true);
              }

              // Move the position of the track and cancel timer.
              sound._seek = seek;
              sound._ended = false;
              self._clearTimer(id);

              // Update the seek position for HTML5 Audio.
              if (!self._webAudio && sound._node && !isNaN(sound._node.duration)) {
                sound._node.currentTime = seek;
              }

              // Seek and emit when ready.
              var seekAndEmit = function() {
                self._emit('seek', id);

                // Restart the playback if the sound was playing.
                if (playing) {
                  self.play(id, true);
                }
              };

              // Wait for the play lock to be unset before emitting (HTML5 Audio).
              if (playing && !self._webAudio) {
                var emitSeek = function() {
                  if (!self._playLock) {
                    seekAndEmit();
                  } else {
                    setTimeout(emitSeek, 0);
                  }
                };
                setTimeout(emitSeek, 0);
              } else {
                seekAndEmit();
              }
            } else {
              if (self._webAudio) {
                var realTime = self.playing(id) ? Howler.ctx.currentTime - sound._playStart : 0;
                var rateSeek = sound._rateSeek ? sound._rateSeek - sound._seek : 0;
                return sound._seek + (rateSeek + realTime * Math.abs(sound._rate));
              } else {
                return sound._node.currentTime;
              }
            }
          }

          return self;
        },

        /**
         * Check if a specific sound is currently playing or not (if id is provided), or check if at least one of the sounds in the group is playing or not.
         * @param  {Number}  id The sound id to check. If none is passed, the whole sound group is checked.
         * @return {Boolean} True if playing and false if not.
         */
        playing: function(id) {
          var self = this;

          // Check the passed sound ID (if any).
          if (typeof id === 'number') {
            var sound = self._soundById(id);
            return sound ? !sound._paused : false;
          }

          // Otherwise, loop through all sounds and check if any are playing.
          for (var i=0; i<self._sounds.length; i++) {
            if (!self._sounds[i]._paused) {
              return true;
            }
          }

          return false;
        },

        /**
         * Get the duration of this sound. Passing a sound id will return the sprite duration.
         * @param  {Number} id The sound id to check. If none is passed, return full source duration.
         * @return {Number} Audio duration in seconds.
         */
        duration: function(id) {
          var self = this;
          var duration = self._duration;

          // If we pass an ID, get the sound and return the sprite length.
          var sound = self._soundById(id);
          if (sound) {
            duration = self._sprite[sound._sprite][1] / 1000;
          }

          return duration;
        },

        /**
         * Returns the current loaded state of this Howl.
         * @return {String} 'unloaded', 'loading', 'loaded'
         */
        state: function() {
          return this._state;
        },

        /**
         * Unload and destroy the current Howl object.
         * This will immediately stop all sound instances attached to this group.
         */
        unload: function() {
          var self = this;

          // Stop playing any active sounds.
          var sounds = self._sounds;
          for (var i=0; i<sounds.length; i++) {
            // Stop the sound if it is currently playing.
            if (!sounds[i]._paused) {
              self.stop(sounds[i]._id);
            }

            // Remove the source or disconnect.
            if (!self._webAudio) {
              // Set the source to 0-second silence to stop any downloading (except in IE).
              self._clearSound(sounds[i]._node);

              // Remove any event listeners.
              sounds[i]._node.removeEventListener('error', sounds[i]._errorFn, false);
              sounds[i]._node.removeEventListener(Howler._canPlayEvent, sounds[i]._loadFn, false);
              sounds[i]._node.removeEventListener('ended', sounds[i]._endFn, false);

              // Release the Audio object back to the pool.
              Howler._releaseHtml5Audio(sounds[i]._node);
            }

            // Empty out all of the nodes.
            delete sounds[i]._node;

            // Make sure all timers are cleared out.
            self._clearTimer(sounds[i]._id);
          }

          // Remove the references in the global Howler object.
          var index = Howler._howls.indexOf(self);
          if (index >= 0) {
            Howler._howls.splice(index, 1);
          }

          // Delete this sound from the cache (if no other Howl is using it).
          var remCache = true;
          for (i=0; i<Howler._howls.length; i++) {
            if (Howler._howls[i]._src === self._src || self._src.indexOf(Howler._howls[i]._src) >= 0) {
              remCache = false;
              break;
            }
          }

          if (cache && remCache) {
            delete cache[self._src];
          }

          // Clear global errors.
          Howler.noAudio = false;

          // Clear out `self`.
          self._state = 'unloaded';
          self._sounds = [];
          self = null;

          return null;
        },

        /**
         * Listen to a custom event.
         * @param  {String}   event Event name.
         * @param  {Function} fn    Listener to call.
         * @param  {Number}   id    (optional) Only listen to events for this sound.
         * @param  {Number}   once  (INTERNAL) Marks event to fire only once.
         * @return {Howl}
         */
        on: function(event, fn, id, once) {
          var self = this;
          var events = self['_on' + event];

          if (typeof fn === 'function') {
            events.push(once ? {id: id, fn: fn, once: once} : {id: id, fn: fn});
          }

          return self;
        },

        /**
         * Remove a custom event. Call without parameters to remove all events.
         * @param  {String}   event Event name.
         * @param  {Function} fn    Listener to remove. Leave empty to remove all.
         * @param  {Number}   id    (optional) Only remove events for this sound.
         * @return {Howl}
         */
        off: function(event, fn, id) {
          var self = this;
          var events = self['_on' + event];
          var i = 0;

          // Allow passing just an event and ID.
          if (typeof fn === 'number') {
            id = fn;
            fn = null;
          }

          if (fn || id) {
            // Loop through event store and remove the passed function.
            for (i=0; i<events.length; i++) {
              var isId = (id === events[i].id);
              if (fn === events[i].fn && isId || !fn && isId) {
                events.splice(i, 1);
                break;
              }
            }
          } else if (event) {
            // Clear out all events of this type.
            self['_on' + event] = [];
          } else {
            // Clear out all events of every type.
            var keys = Object.keys(self);
            for (i=0; i<keys.length; i++) {
              if ((keys[i].indexOf('_on') === 0) && Array.isArray(self[keys[i]])) {
                self[keys[i]] = [];
              }
            }
          }

          return self;
        },

        /**
         * Listen to a custom event and remove it once fired.
         * @param  {String}   event Event name.
         * @param  {Function} fn    Listener to call.
         * @param  {Number}   id    (optional) Only listen to events for this sound.
         * @return {Howl}
         */
        once: function(event, fn, id) {
          var self = this;

          // Setup the event listener.
          self.on(event, fn, id, 1);

          return self;
        },

        /**
         * Emit all events of a specific type and pass the sound id.
         * @param  {String} event Event name.
         * @param  {Number} id    Sound ID.
         * @param  {Number} msg   Message to go with event.
         * @return {Howl}
         */
        _emit: function(event, id, msg) {
          var self = this;
          var events = self['_on' + event];

          // Loop through event store and fire all functions.
          for (var i=events.length-1; i>=0; i--) {
            // Only fire the listener if the correct ID is used.
            if (!events[i].id || events[i].id === id || event === 'load') {
              setTimeout(function(fn) {
                fn.call(this, id, msg);
              }.bind(self, events[i].fn), 0);

              // If this event was setup with `once`, remove it.
              if (events[i].once) {
                self.off(event, events[i].fn, events[i].id);
              }
            }
          }

          // Pass the event type into load queue so that it can continue stepping.
          self._loadQueue(event);

          return self;
        },

        /**
         * Queue of actions initiated before the sound has loaded.
         * These will be called in sequence, with the next only firing
         * after the previous has finished executing (even if async like play).
         * @return {Howl}
         */
        _loadQueue: function(event) {
          var self = this;

          if (self._queue.length > 0) {
            var task = self._queue[0];

            // Remove this task if a matching event was passed.
            if (task.event === event) {
              self._queue.shift();
              self._loadQueue();
            }

            // Run the task if no event type is passed.
            if (!event) {
              task.action();
            }
          }

          return self;
        },

        /**
         * Fired when playback ends at the end of the duration.
         * @param  {Sound} sound The sound object to work with.
         * @return {Howl}
         */
        _ended: function(sound) {
          var self = this;
          var sprite = sound._sprite;

          // If we are using IE and there was network latency we may be clipping
          // audio before it completes playing. Lets check the node to make sure it
          // believes it has completed, before ending the playback.
          if (!self._webAudio && sound._node && !sound._node.paused && !sound._node.ended && sound._node.currentTime < sound._stop) {
            setTimeout(self._ended.bind(self, sound), 100);
            return self;
          }

          // Should this sound loop?
          var loop = !!(sound._loop || self._sprite[sprite][2]);

          // Fire the ended event.
          self._emit('end', sound._id);

          // Restart the playback for HTML5 Audio loop.
          if (!self._webAudio && loop) {
            self.stop(sound._id, true).play(sound._id);
          }

          // Restart this timer if on a Web Audio loop.
          if (self._webAudio && loop) {
            self._emit('play', sound._id);
            sound._seek = sound._start || 0;
            sound._rateSeek = 0;
            sound._playStart = Howler.ctx.currentTime;

            var timeout = ((sound._stop - sound._start) * 1000) / Math.abs(sound._rate);
            self._endTimers[sound._id] = setTimeout(self._ended.bind(self, sound), timeout);
          }

          // Mark the node as paused.
          if (self._webAudio && !loop) {
            sound._paused = true;
            sound._ended = true;
            sound._seek = sound._start || 0;
            sound._rateSeek = 0;
            self._clearTimer(sound._id);

            // Clean up the buffer source.
            self._cleanBuffer(sound._node);

            // Attempt to auto-suspend AudioContext if no sounds are still playing.
            Howler._autoSuspend();
          }

          // When using a sprite, end the track.
          if (!self._webAudio && !loop) {
            self.stop(sound._id, true);
          }

          return self;
        },

        /**
         * Clear the end timer for a sound playback.
         * @param  {Number} id The sound ID.
         * @return {Howl}
         */
        _clearTimer: function(id) {
          var self = this;

          if (self._endTimers[id]) {
            // Clear the timeout or remove the ended listener.
            if (typeof self._endTimers[id] !== 'function') {
              clearTimeout(self._endTimers[id]);
            } else {
              var sound = self._soundById(id);
              if (sound && sound._node) {
                sound._node.removeEventListener('ended', self._endTimers[id], false);
              }
            }

            delete self._endTimers[id];
          }

          return self;
        },

        /**
         * Return the sound identified by this ID, or return null.
         * @param  {Number} id Sound ID
         * @return {Object}    Sound object or null.
         */
        _soundById: function(id) {
          var self = this;

          // Loop through all sounds and find the one with this ID.
          for (var i=0; i<self._sounds.length; i++) {
            if (id === self._sounds[i]._id) {
              return self._sounds[i];
            }
          }

          return null;
        },

        /**
         * Return an inactive sound from the pool or create a new one.
         * @return {Sound} Sound playback object.
         */
        _inactiveSound: function() {
          var self = this;

          self._drain();

          // Find the first inactive node to recycle.
          for (var i=0; i<self._sounds.length; i++) {
            if (self._sounds[i]._ended) {
              return self._sounds[i].reset();
            }
          }

          // If no inactive node was found, create a new one.
          return new Sound(self);
        },

        /**
         * Drain excess inactive sounds from the pool.
         */
        _drain: function() {
          var self = this;
          var limit = self._pool;
          var cnt = 0;
          var i = 0;

          // If there are less sounds than the max pool size, we are done.
          if (self._sounds.length < limit) {
            return;
          }

          // Count the number of inactive sounds.
          for (i=0; i<self._sounds.length; i++) {
            if (self._sounds[i]._ended) {
              cnt++;
            }
          }

          // Remove excess inactive sounds, going in reverse order.
          for (i=self._sounds.length - 1; i>=0; i--) {
            if (cnt <= limit) {
              return;
            }

            if (self._sounds[i]._ended) {
              // Disconnect the audio source when using Web Audio.
              if (self._webAudio && self._sounds[i]._node) {
                self._sounds[i]._node.disconnect(0);
              }

              // Remove sounds until we have the pool size.
              self._sounds.splice(i, 1);
              cnt--;
            }
          }
        },

        /**
         * Get all ID's from the sounds pool.
         * @param  {Number} id Only return one ID if one is passed.
         * @return {Array}    Array of IDs.
         */
        _getSoundIds: function(id) {
          var self = this;

          if (typeof id === 'undefined') {
            var ids = [];
            for (var i=0; i<self._sounds.length; i++) {
              ids.push(self._sounds[i]._id);
            }

            return ids;
          } else {
            return [id];
          }
        },

        /**
         * Load the sound back into the buffer source.
         * @param  {Sound} sound The sound object to work with.
         * @return {Howl}
         */
        _refreshBuffer: function(sound) {
          var self = this;

          // Setup the buffer source for playback.
          sound._node.bufferSource = Howler.ctx.createBufferSource();
          sound._node.bufferSource.buffer = cache[self._src];

          // Connect to the correct node.
          if (sound._panner) {
            sound._node.bufferSource.connect(sound._panner);
          } else {
            sound._node.bufferSource.connect(sound._node);
          }

          // Setup looping and playback rate.
          sound._node.bufferSource.loop = sound._loop;
          if (sound._loop) {
            sound._node.bufferSource.loopStart = sound._start || 0;
            sound._node.bufferSource.loopEnd = sound._stop || 0;
          }
          sound._node.bufferSource.playbackRate.setValueAtTime(sound._rate, Howler.ctx.currentTime);

          return self;
        },

        /**
         * Prevent memory leaks by cleaning up the buffer source after playback.
         * @param  {Object} node Sound's audio node containing the buffer source.
         * @return {Howl}
         */
        _cleanBuffer: function(node) {
          var self = this;
          var isIOS = Howler._navigator && Howler._navigator.vendor.indexOf('Apple') >= 0;

          if (Howler._scratchBuffer && node.bufferSource) {
            node.bufferSource.onended = null;
            node.bufferSource.disconnect(0);
            if (isIOS) {
              try { node.bufferSource.buffer = Howler._scratchBuffer; } catch(e) {}
            }
          }
          node.bufferSource = null;

          return self;
        },

        /**
         * Set the source to a 0-second silence to stop any downloading (except in IE).
         * @param  {Object} node Audio node to clear.
         */
        _clearSound: function(node) {
          var checkIE = /MSIE |Trident\//.test(Howler._navigator && Howler._navigator.userAgent);
          if (!checkIE) {
            node.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
          }
        }
      };

      /** Single Sound Methods **/
      /***************************************************************************/

      /**
       * Setup the sound object, which each node attached to a Howl group is contained in.
       * @param {Object} howl The Howl parent group.
       */
      var Sound = function(howl) {
        this._parent = howl;
        this.init();
      };
      Sound.prototype = {
        /**
         * Initialize a new Sound object.
         * @return {Sound}
         */
        init: function() {
          var self = this;
          var parent = self._parent;

          // Setup the default parameters.
          self._muted = parent._muted;
          self._loop = parent._loop;
          self._volume = parent._volume;
          self._rate = parent._rate;
          self._seek = 0;
          self._paused = true;
          self._ended = true;
          self._sprite = '__default';

          // Generate a unique ID for this sound.
          self._id = ++Howler._counter;

          // Add itself to the parent's pool.
          parent._sounds.push(self);

          // Create the new node.
          self.create();

          return self;
        },

        /**
         * Create and setup a new sound object, whether HTML5 Audio or Web Audio.
         * @return {Sound}
         */
        create: function() {
          var self = this;
          var parent = self._parent;
          var volume = (Howler._muted || self._muted || self._parent._muted) ? 0 : self._volume;

          if (parent._webAudio) {
            // Create the gain node for controlling volume (the source will connect to this).
            self._node = (typeof Howler.ctx.createGain === 'undefined') ? Howler.ctx.createGainNode() : Howler.ctx.createGain();
            self._node.gain.setValueAtTime(volume, Howler.ctx.currentTime);
            self._node.paused = true;
            self._node.connect(Howler.masterGain);
          } else if (!Howler.noAudio) {
            // Get an unlocked Audio object from the pool.
            self._node = Howler._obtainHtml5Audio();

            // Listen for errors (http://dev.w3.org/html5/spec-author-view/spec.html#mediaerror).
            self._errorFn = self._errorListener.bind(self);
            self._node.addEventListener('error', self._errorFn, false);

            // Listen for 'canplaythrough' event to let us know the sound is ready.
            self._loadFn = self._loadListener.bind(self);
            self._node.addEventListener(Howler._canPlayEvent, self._loadFn, false);

            // Listen for the 'ended' event on the sound to account for edge-case where
            // a finite sound has a duration of Infinity.
            self._endFn = self._endListener.bind(self);
            self._node.addEventListener('ended', self._endFn, false);

            // Setup the new audio node.
            self._node.src = parent._src;
            self._node.preload = parent._preload === true ? 'auto' : parent._preload;
            self._node.volume = volume * Howler.volume();

            // Begin loading the source.
            self._node.load();
          }

          return self;
        },

        /**
         * Reset the parameters of this sound to the original state (for recycle).
         * @return {Sound}
         */
        reset: function() {
          var self = this;
          var parent = self._parent;

          // Reset all of the parameters of this sound.
          self._muted = parent._muted;
          self._loop = parent._loop;
          self._volume = parent._volume;
          self._rate = parent._rate;
          self._seek = 0;
          self._rateSeek = 0;
          self._paused = true;
          self._ended = true;
          self._sprite = '__default';

          // Generate a new ID so that it isn't confused with the previous sound.
          self._id = ++Howler._counter;

          return self;
        },

        /**
         * HTML5 Audio error listener callback.
         */
        _errorListener: function() {
          var self = this;

          // Fire an error event and pass back the code.
          self._parent._emit('loaderror', self._id, self._node.error ? self._node.error.code : 0);

          // Clear the event listener.
          self._node.removeEventListener('error', self._errorFn, false);
        },

        /**
         * HTML5 Audio canplaythrough listener callback.
         */
        _loadListener: function() {
          var self = this;
          var parent = self._parent;

          // Round up the duration to account for the lower precision in HTML5 Audio.
          parent._duration = Math.ceil(self._node.duration * 10) / 10;

          // Setup a sprite if none is defined.
          if (Object.keys(parent._sprite).length === 0) {
            parent._sprite = {__default: [0, parent._duration * 1000]};
          }

          if (parent._state !== 'loaded') {
            parent._state = 'loaded';
            parent._emit('load');
            parent._loadQueue();
          }

          // Clear the event listener.
          self._node.removeEventListener(Howler._canPlayEvent, self._loadFn, false);
        },

        /**
         * HTML5 Audio ended listener callback.
         */
        _endListener: function() {
          var self = this;
          var parent = self._parent;

          // Only handle the `ended`` event if the duration is Infinity.
          if (parent._duration === Infinity) {
            // Update the parent duration to match the real audio duration.
            // Round up the duration to account for the lower precision in HTML5 Audio.
            parent._duration = Math.ceil(self._node.duration * 10) / 10;

            // Update the sprite that corresponds to the real duration.
            if (parent._sprite.__default[1] === Infinity) {
              parent._sprite.__default[1] = parent._duration * 1000;
            }

            // Run the regular ended method.
            parent._ended(self);
          }

          // Clear the event listener since the duration is now correct.
          self._node.removeEventListener('ended', self._endFn, false);
        }
      };

      /** Helper Methods **/
      /***************************************************************************/

      var cache = {};

      /**
       * Buffer a sound from URL, Data URI or cache and decode to audio source (Web Audio API).
       * @param  {Howl} self
       */
      var loadBuffer = function(self) {
        var url = self._src;

        // Check if the buffer has already been cached and use it instead.
        if (cache[url]) {
          // Set the duration from the cache.
          self._duration = cache[url].duration;

          // Load the sound into this Howl.
          loadSound(self);

          return;
        }

        if (/^data:[^;]+;base64,/.test(url)) {
          // Decode the base64 data URI without XHR, since some browsers don't support it.
          var data = atob(url.split(',')[1]);
          var dataView = new Uint8Array(data.length);
          for (var i=0; i<data.length; ++i) {
            dataView[i] = data.charCodeAt(i);
          }

          decodeAudioData(dataView.buffer, self);
        } else {
          // Load the buffer from the URL.
          var xhr = new XMLHttpRequest();
          xhr.open(self._xhr.method, url, true);
          xhr.withCredentials = self._xhr.withCredentials;
          xhr.responseType = 'arraybuffer';

          // Apply any custom headers to the request.
          if (self._xhr.headers) {
            Object.keys(self._xhr.headers).forEach(function(key) {
              xhr.setRequestHeader(key, self._xhr.headers[key]);
            });
          }

          xhr.onload = function() {
            // Make sure we get a successful response back.
            var code = (xhr.status + '')[0];
            if (code !== '0' && code !== '2' && code !== '3') {
              self._emit('loaderror', null, 'Failed loading audio file with status: ' + xhr.status + '.');
              return;
            }

            decodeAudioData(xhr.response, self);
          };
          xhr.onerror = function() {
            // If there is an error, switch to HTML5 Audio.
            if (self._webAudio) {
              self._html5 = true;
              self._webAudio = false;
              self._sounds = [];
              delete cache[url];
              self.load();
            }
          };
          safeXhrSend(xhr);
        }
      };

      /**
       * Send the XHR request wrapped in a try/catch.
       * @param  {Object} xhr XHR to send.
       */
      var safeXhrSend = function(xhr) {
        try {
          xhr.send();
        } catch (e) {
          xhr.onerror();
        }
      };

      /**
       * Decode audio data from an array buffer.
       * @param  {ArrayBuffer} arraybuffer The audio data.
       * @param  {Howl}        self
       */
      var decodeAudioData = function(arraybuffer, self) {
        // Fire a load error if something broke.
        var error = function() {
          self._emit('loaderror', null, 'Decoding audio data failed.');
        };

        // Load the sound on success.
        var success = function(buffer) {
          if (buffer && self._sounds.length > 0) {
            cache[self._src] = buffer;
            loadSound(self, buffer);
          } else {
            error();
          }
        };

        // Decode the buffer into an audio source.
        if (typeof Promise !== 'undefined' && Howler.ctx.decodeAudioData.length === 1) {
          Howler.ctx.decodeAudioData(arraybuffer).then(success).catch(error);
        } else {
          Howler.ctx.decodeAudioData(arraybuffer, success, error);
        }
      };

      /**
       * Sound is now loaded, so finish setting everything up and fire the loaded event.
       * @param  {Howl} self
       * @param  {Object} buffer The decoded buffer sound source.
       */
      var loadSound = function(self, buffer) {
        // Set the duration.
        if (buffer && !self._duration) {
          self._duration = buffer.duration;
        }

        // Setup a sprite if none is defined.
        if (Object.keys(self._sprite).length === 0) {
          self._sprite = {__default: [0, self._duration * 1000]};
        }

        // Fire the loaded event.
        if (self._state !== 'loaded') {
          self._state = 'loaded';
          self._emit('load');
          self._loadQueue();
        }
      };

      /**
       * Setup the audio context when available, or switch to HTML5 Audio mode.
       */
      var setupAudioContext = function() {
        // If we have already detected that Web Audio isn't supported, don't run this step again.
        if (!Howler.usingWebAudio) {
          return;
        }

        // Check if we are using Web Audio and setup the AudioContext if we are.
        try {
          if (typeof AudioContext !== 'undefined') {
            Howler.ctx = new AudioContext();
          } else if (typeof webkitAudioContext !== 'undefined') {
            Howler.ctx = new webkitAudioContext();
          } else {
            Howler.usingWebAudio = false;
          }
        } catch(e) {
          Howler.usingWebAudio = false;
        }

        // If the audio context creation still failed, set using web audio to false.
        if (!Howler.ctx) {
          Howler.usingWebAudio = false;
        }

        // Check if a webview is being used on iOS8 or earlier (rather than the browser).
        // If it is, disable Web Audio as it causes crashing.
        var iOS = (/iP(hone|od|ad)/.test(Howler._navigator && Howler._navigator.platform));
        var appVersion = Howler._navigator && Howler._navigator.appVersion.match(/OS (\d+)_(\d+)_?(\d+)?/);
        var version = appVersion ? parseInt(appVersion[1], 10) : null;
        if (iOS && version && version < 9) {
          var safari = /safari/.test(Howler._navigator && Howler._navigator.userAgent.toLowerCase());
          if (Howler._navigator && !safari) {
            Howler.usingWebAudio = false;
          }
        }

        // Create and expose the master GainNode when using Web Audio (useful for plugins or advanced usage).
        if (Howler.usingWebAudio) {
          Howler.masterGain = (typeof Howler.ctx.createGain === 'undefined') ? Howler.ctx.createGainNode() : Howler.ctx.createGain();
          Howler.masterGain.gain.setValueAtTime(Howler._muted ? 0 : Howler._volume, Howler.ctx.currentTime);
          Howler.masterGain.connect(Howler.ctx.destination);
        }

        // Re-run the setup on Howler.
        Howler._setup();
      };

      // Add support for CommonJS libraries such as browserify.
      {
        exports.Howler = Howler;
        exports.Howl = Howl;
      }

      // Add to global in Node.js (for testing, etc).
      if (typeof commonjsGlobal !== 'undefined') {
        commonjsGlobal.HowlerGlobal = HowlerGlobal;
        commonjsGlobal.Howler = Howler;
        commonjsGlobal.Howl = Howl;
        commonjsGlobal.Sound = Sound;
      } else if (typeof window !== 'undefined') {  // Define globally in case AMD is not available or unused.
        window.HowlerGlobal = HowlerGlobal;
        window.Howler = Howler;
        window.Howl = Howl;
        window.Sound = Sound;
      }
    })();


    /*!
     *  Spatial Plugin - Adds support for stereo and 3D audio where Web Audio is supported.
     *  
     *  howler.js v2.2.1
     *  howlerjs.com
     *
     *  (c) 2013-2020, James Simpson of GoldFire Studios
     *  goldfirestudios.com
     *
     *  MIT License
     */

    (function() {

      // Setup default properties.
      HowlerGlobal.prototype._pos = [0, 0, 0];
      HowlerGlobal.prototype._orientation = [0, 0, -1, 0, 1, 0];

      /** Global Methods **/
      /***************************************************************************/

      /**
       * Helper method to update the stereo panning position of all current Howls.
       * Future Howls will not use this value unless explicitly set.
       * @param  {Number} pan A value of -1.0 is all the way left and 1.0 is all the way right.
       * @return {Howler/Number}     Self or current stereo panning value.
       */
      HowlerGlobal.prototype.stereo = function(pan) {
        var self = this;

        // Stop right here if not using Web Audio.
        if (!self.ctx || !self.ctx.listener) {
          return self;
        }

        // Loop through all Howls and update their stereo panning.
        for (var i=self._howls.length-1; i>=0; i--) {
          self._howls[i].stereo(pan);
        }

        return self;
      };

      /**
       * Get/set the position of the listener in 3D cartesian space. Sounds using
       * 3D position will be relative to the listener's position.
       * @param  {Number} x The x-position of the listener.
       * @param  {Number} y The y-position of the listener.
       * @param  {Number} z The z-position of the listener.
       * @return {Howler/Array}   Self or current listener position.
       */
      HowlerGlobal.prototype.pos = function(x, y, z) {
        var self = this;

        // Stop right here if not using Web Audio.
        if (!self.ctx || !self.ctx.listener) {
          return self;
        }

        // Set the defaults for optional 'y' & 'z'.
        y = (typeof y !== 'number') ? self._pos[1] : y;
        z = (typeof z !== 'number') ? self._pos[2] : z;

        if (typeof x === 'number') {
          self._pos = [x, y, z];

          if (typeof self.ctx.listener.positionX !== 'undefined') {
            self.ctx.listener.positionX.setTargetAtTime(self._pos[0], Howler.ctx.currentTime, 0.1);
            self.ctx.listener.positionY.setTargetAtTime(self._pos[1], Howler.ctx.currentTime, 0.1);
            self.ctx.listener.positionZ.setTargetAtTime(self._pos[2], Howler.ctx.currentTime, 0.1);
          } else {
            self.ctx.listener.setPosition(self._pos[0], self._pos[1], self._pos[2]);
          }
        } else {
          return self._pos;
        }

        return self;
      };

      /**
       * Get/set the direction the listener is pointing in the 3D cartesian space.
       * A front and up vector must be provided. The front is the direction the
       * face of the listener is pointing, and up is the direction the top of the
       * listener is pointing. Thus, these values are expected to be at right angles
       * from each other.
       * @param  {Number} x   The x-orientation of the listener.
       * @param  {Number} y   The y-orientation of the listener.
       * @param  {Number} z   The z-orientation of the listener.
       * @param  {Number} xUp The x-orientation of the top of the listener.
       * @param  {Number} yUp The y-orientation of the top of the listener.
       * @param  {Number} zUp The z-orientation of the top of the listener.
       * @return {Howler/Array}     Returns self or the current orientation vectors.
       */
      HowlerGlobal.prototype.orientation = function(x, y, z, xUp, yUp, zUp) {
        var self = this;

        // Stop right here if not using Web Audio.
        if (!self.ctx || !self.ctx.listener) {
          return self;
        }

        // Set the defaults for optional 'y' & 'z'.
        var or = self._orientation;
        y = (typeof y !== 'number') ? or[1] : y;
        z = (typeof z !== 'number') ? or[2] : z;
        xUp = (typeof xUp !== 'number') ? or[3] : xUp;
        yUp = (typeof yUp !== 'number') ? or[4] : yUp;
        zUp = (typeof zUp !== 'number') ? or[5] : zUp;

        if (typeof x === 'number') {
          self._orientation = [x, y, z, xUp, yUp, zUp];

          if (typeof self.ctx.listener.forwardX !== 'undefined') {
            self.ctx.listener.forwardX.setTargetAtTime(x, Howler.ctx.currentTime, 0.1);
            self.ctx.listener.forwardY.setTargetAtTime(y, Howler.ctx.currentTime, 0.1);
            self.ctx.listener.forwardZ.setTargetAtTime(z, Howler.ctx.currentTime, 0.1);
            self.ctx.listener.upX.setTargetAtTime(xUp, Howler.ctx.currentTime, 0.1);
            self.ctx.listener.upY.setTargetAtTime(yUp, Howler.ctx.currentTime, 0.1);
            self.ctx.listener.upZ.setTargetAtTime(zUp, Howler.ctx.currentTime, 0.1);
          } else {
            self.ctx.listener.setOrientation(x, y, z, xUp, yUp, zUp);
          }
        } else {
          return or;
        }

        return self;
      };

      /** Group Methods **/
      /***************************************************************************/

      /**
       * Add new properties to the core init.
       * @param  {Function} _super Core init method.
       * @return {Howl}
       */
      Howl.prototype.init = (function(_super) {
        return function(o) {
          var self = this;

          // Setup user-defined default properties.
          self._orientation = o.orientation || [1, 0, 0];
          self._stereo = o.stereo || null;
          self._pos = o.pos || null;
          self._pannerAttr = {
            coneInnerAngle: typeof o.coneInnerAngle !== 'undefined' ? o.coneInnerAngle : 360,
            coneOuterAngle: typeof o.coneOuterAngle !== 'undefined' ? o.coneOuterAngle : 360,
            coneOuterGain: typeof o.coneOuterGain !== 'undefined' ? o.coneOuterGain : 0,
            distanceModel: typeof o.distanceModel !== 'undefined' ? o.distanceModel : 'inverse',
            maxDistance: typeof o.maxDistance !== 'undefined' ? o.maxDistance : 10000,
            panningModel: typeof o.panningModel !== 'undefined' ? o.panningModel : 'HRTF',
            refDistance: typeof o.refDistance !== 'undefined' ? o.refDistance : 1,
            rolloffFactor: typeof o.rolloffFactor !== 'undefined' ? o.rolloffFactor : 1
          };

          // Setup event listeners.
          self._onstereo = o.onstereo ? [{fn: o.onstereo}] : [];
          self._onpos = o.onpos ? [{fn: o.onpos}] : [];
          self._onorientation = o.onorientation ? [{fn: o.onorientation}] : [];

          // Complete initilization with howler.js core's init function.
          return _super.call(this, o);
        };
      })(Howl.prototype.init);

      /**
       * Get/set the stereo panning of the audio source for this sound or all in the group.
       * @param  {Number} pan  A value of -1.0 is all the way left and 1.0 is all the way right.
       * @param  {Number} id (optional) The sound ID. If none is passed, all in group will be updated.
       * @return {Howl/Number}    Returns self or the current stereo panning value.
       */
      Howl.prototype.stereo = function(pan, id) {
        var self = this;

        // Stop right here if not using Web Audio.
        if (!self._webAudio) {
          return self;
        }

        // If the sound hasn't loaded, add it to the load queue to change stereo pan when capable.
        if (self._state !== 'loaded') {
          self._queue.push({
            event: 'stereo',
            action: function() {
              self.stereo(pan, id);
            }
          });

          return self;
        }

        // Check for PannerStereoNode support and fallback to PannerNode if it doesn't exist.
        var pannerType = (typeof Howler.ctx.createStereoPanner === 'undefined') ? 'spatial' : 'stereo';

        // Setup the group's stereo panning if no ID is passed.
        if (typeof id === 'undefined') {
          // Return the group's stereo panning if no parameters are passed.
          if (typeof pan === 'number') {
            self._stereo = pan;
            self._pos = [pan, 0, 0];
          } else {
            return self._stereo;
          }
        }

        // Change the streo panning of one or all sounds in group.
        var ids = self._getSoundIds(id);
        for (var i=0; i<ids.length; i++) {
          // Get the sound.
          var sound = self._soundById(ids[i]);

          if (sound) {
            if (typeof pan === 'number') {
              sound._stereo = pan;
              sound._pos = [pan, 0, 0];

              if (sound._node) {
                // If we are falling back, make sure the panningModel is equalpower.
                sound._pannerAttr.panningModel = 'equalpower';

                // Check if there is a panner setup and create a new one if not.
                if (!sound._panner || !sound._panner.pan) {
                  setupPanner(sound, pannerType);
                }

                if (pannerType === 'spatial') {
                  if (typeof sound._panner.positionX !== 'undefined') {
                    sound._panner.positionX.setValueAtTime(pan, Howler.ctx.currentTime);
                    sound._panner.positionY.setValueAtTime(0, Howler.ctx.currentTime);
                    sound._panner.positionZ.setValueAtTime(0, Howler.ctx.currentTime);
                  } else {
                    sound._panner.setPosition(pan, 0, 0);
                  }
                } else {
                  sound._panner.pan.setValueAtTime(pan, Howler.ctx.currentTime);
                }
              }

              self._emit('stereo', sound._id);
            } else {
              return sound._stereo;
            }
          }
        }

        return self;
      };

      /**
       * Get/set the 3D spatial position of the audio source for this sound or group relative to the global listener.
       * @param  {Number} x  The x-position of the audio source.
       * @param  {Number} y  The y-position of the audio source.
       * @param  {Number} z  The z-position of the audio source.
       * @param  {Number} id (optional) The sound ID. If none is passed, all in group will be updated.
       * @return {Howl/Array}    Returns self or the current 3D spatial position: [x, y, z].
       */
      Howl.prototype.pos = function(x, y, z, id) {
        var self = this;

        // Stop right here if not using Web Audio.
        if (!self._webAudio) {
          return self;
        }

        // If the sound hasn't loaded, add it to the load queue to change position when capable.
        if (self._state !== 'loaded') {
          self._queue.push({
            event: 'pos',
            action: function() {
              self.pos(x, y, z, id);
            }
          });

          return self;
        }

        // Set the defaults for optional 'y' & 'z'.
        y = (typeof y !== 'number') ? 0 : y;
        z = (typeof z !== 'number') ? -0.5 : z;

        // Setup the group's spatial position if no ID is passed.
        if (typeof id === 'undefined') {
          // Return the group's spatial position if no parameters are passed.
          if (typeof x === 'number') {
            self._pos = [x, y, z];
          } else {
            return self._pos;
          }
        }

        // Change the spatial position of one or all sounds in group.
        var ids = self._getSoundIds(id);
        for (var i=0; i<ids.length; i++) {
          // Get the sound.
          var sound = self._soundById(ids[i]);

          if (sound) {
            if (typeof x === 'number') {
              sound._pos = [x, y, z];

              if (sound._node) {
                // Check if there is a panner setup and create a new one if not.
                if (!sound._panner || sound._panner.pan) {
                  setupPanner(sound, 'spatial');
                }

                if (typeof sound._panner.positionX !== 'undefined') {
                  sound._panner.positionX.setValueAtTime(x, Howler.ctx.currentTime);
                  sound._panner.positionY.setValueAtTime(y, Howler.ctx.currentTime);
                  sound._panner.positionZ.setValueAtTime(z, Howler.ctx.currentTime);
                } else {
                  sound._panner.setPosition(x, y, z);
                }
              }

              self._emit('pos', sound._id);
            } else {
              return sound._pos;
            }
          }
        }

        return self;
      };

      /**
       * Get/set the direction the audio source is pointing in the 3D cartesian coordinate
       * space. Depending on how direction the sound is, based on the `cone` attributes,
       * a sound pointing away from the listener can be quiet or silent.
       * @param  {Number} x  The x-orientation of the source.
       * @param  {Number} y  The y-orientation of the source.
       * @param  {Number} z  The z-orientation of the source.
       * @param  {Number} id (optional) The sound ID. If none is passed, all in group will be updated.
       * @return {Howl/Array}    Returns self or the current 3D spatial orientation: [x, y, z].
       */
      Howl.prototype.orientation = function(x, y, z, id) {
        var self = this;

        // Stop right here if not using Web Audio.
        if (!self._webAudio) {
          return self;
        }

        // If the sound hasn't loaded, add it to the load queue to change orientation when capable.
        if (self._state !== 'loaded') {
          self._queue.push({
            event: 'orientation',
            action: function() {
              self.orientation(x, y, z, id);
            }
          });

          return self;
        }

        // Set the defaults for optional 'y' & 'z'.
        y = (typeof y !== 'number') ? self._orientation[1] : y;
        z = (typeof z !== 'number') ? self._orientation[2] : z;

        // Setup the group's spatial orientation if no ID is passed.
        if (typeof id === 'undefined') {
          // Return the group's spatial orientation if no parameters are passed.
          if (typeof x === 'number') {
            self._orientation = [x, y, z];
          } else {
            return self._orientation;
          }
        }

        // Change the spatial orientation of one or all sounds in group.
        var ids = self._getSoundIds(id);
        for (var i=0; i<ids.length; i++) {
          // Get the sound.
          var sound = self._soundById(ids[i]);

          if (sound) {
            if (typeof x === 'number') {
              sound._orientation = [x, y, z];

              if (sound._node) {
                // Check if there is a panner setup and create a new one if not.
                if (!sound._panner) {
                  // Make sure we have a position to setup the node with.
                  if (!sound._pos) {
                    sound._pos = self._pos || [0, 0, -0.5];
                  }

                  setupPanner(sound, 'spatial');
                }

                if (typeof sound._panner.orientationX !== 'undefined') {
                  sound._panner.orientationX.setValueAtTime(x, Howler.ctx.currentTime);
                  sound._panner.orientationY.setValueAtTime(y, Howler.ctx.currentTime);
                  sound._panner.orientationZ.setValueAtTime(z, Howler.ctx.currentTime);
                } else {
                  sound._panner.setOrientation(x, y, z);
                }
              }

              self._emit('orientation', sound._id);
            } else {
              return sound._orientation;
            }
          }
        }

        return self;
      };

      /**
       * Get/set the panner node's attributes for a sound or group of sounds.
       * This method can optionall take 0, 1 or 2 arguments.
       *   pannerAttr() -> Returns the group's values.
       *   pannerAttr(id) -> Returns the sound id's values.
       *   pannerAttr(o) -> Set's the values of all sounds in this Howl group.
       *   pannerAttr(o, id) -> Set's the values of passed sound id.
       *
       *   Attributes:
       *     coneInnerAngle - (360 by default) A parameter for directional audio sources, this is an angle, in degrees,
       *                      inside of which there will be no volume reduction.
       *     coneOuterAngle - (360 by default) A parameter for directional audio sources, this is an angle, in degrees,
       *                      outside of which the volume will be reduced to a constant value of `coneOuterGain`.
       *     coneOuterGain - (0 by default) A parameter for directional audio sources, this is the gain outside of the
       *                     `coneOuterAngle`. It is a linear value in the range `[0, 1]`.
       *     distanceModel - ('inverse' by default) Determines algorithm used to reduce volume as audio moves away from
       *                     listener. Can be `linear`, `inverse` or `exponential.
       *     maxDistance - (10000 by default) The maximum distance between source and listener, after which the volume
       *                   will not be reduced any further.
       *     refDistance - (1 by default) A reference distance for reducing volume as source moves further from the listener.
       *                   This is simply a variable of the distance model and has a different effect depending on which model
       *                   is used and the scale of your coordinates. Generally, volume will be equal to 1 at this distance.
       *     rolloffFactor - (1 by default) How quickly the volume reduces as source moves from listener. This is simply a
       *                     variable of the distance model and can be in the range of `[0, 1]` with `linear` and `[0, ∞]`
       *                     with `inverse` and `exponential`.
       *     panningModel - ('HRTF' by default) Determines which spatialization algorithm is used to position audio.
       *                     Can be `HRTF` or `equalpower`.
       *
       * @return {Howl/Object} Returns self or current panner attributes.
       */
      Howl.prototype.pannerAttr = function() {
        var self = this;
        var args = arguments;
        var o, id, sound;

        // Stop right here if not using Web Audio.
        if (!self._webAudio) {
          return self;
        }

        // Determine the values based on arguments.
        if (args.length === 0) {
          // Return the group's panner attribute values.
          return self._pannerAttr;
        } else if (args.length === 1) {
          if (typeof args[0] === 'object') {
            o = args[0];

            // Set the grou's panner attribute values.
            if (typeof id === 'undefined') {
              if (!o.pannerAttr) {
                o.pannerAttr = {
                  coneInnerAngle: o.coneInnerAngle,
                  coneOuterAngle: o.coneOuterAngle,
                  coneOuterGain: o.coneOuterGain,
                  distanceModel: o.distanceModel,
                  maxDistance: o.maxDistance,
                  refDistance: o.refDistance,
                  rolloffFactor: o.rolloffFactor,
                  panningModel: o.panningModel
                };
              }

              self._pannerAttr = {
                coneInnerAngle: typeof o.pannerAttr.coneInnerAngle !== 'undefined' ? o.pannerAttr.coneInnerAngle : self._coneInnerAngle,
                coneOuterAngle: typeof o.pannerAttr.coneOuterAngle !== 'undefined' ? o.pannerAttr.coneOuterAngle : self._coneOuterAngle,
                coneOuterGain: typeof o.pannerAttr.coneOuterGain !== 'undefined' ? o.pannerAttr.coneOuterGain : self._coneOuterGain,
                distanceModel: typeof o.pannerAttr.distanceModel !== 'undefined' ? o.pannerAttr.distanceModel : self._distanceModel,
                maxDistance: typeof o.pannerAttr.maxDistance !== 'undefined' ? o.pannerAttr.maxDistance : self._maxDistance,
                refDistance: typeof o.pannerAttr.refDistance !== 'undefined' ? o.pannerAttr.refDistance : self._refDistance,
                rolloffFactor: typeof o.pannerAttr.rolloffFactor !== 'undefined' ? o.pannerAttr.rolloffFactor : self._rolloffFactor,
                panningModel: typeof o.pannerAttr.panningModel !== 'undefined' ? o.pannerAttr.panningModel : self._panningModel
              };
            }
          } else {
            // Return this sound's panner attribute values.
            sound = self._soundById(parseInt(args[0], 10));
            return sound ? sound._pannerAttr : self._pannerAttr;
          }
        } else if (args.length === 2) {
          o = args[0];
          id = parseInt(args[1], 10);
        }

        // Update the values of the specified sounds.
        var ids = self._getSoundIds(id);
        for (var i=0; i<ids.length; i++) {
          sound = self._soundById(ids[i]);

          if (sound) {
            // Merge the new values into the sound.
            var pa = sound._pannerAttr;
            pa = {
              coneInnerAngle: typeof o.coneInnerAngle !== 'undefined' ? o.coneInnerAngle : pa.coneInnerAngle,
              coneOuterAngle: typeof o.coneOuterAngle !== 'undefined' ? o.coneOuterAngle : pa.coneOuterAngle,
              coneOuterGain: typeof o.coneOuterGain !== 'undefined' ? o.coneOuterGain : pa.coneOuterGain,
              distanceModel: typeof o.distanceModel !== 'undefined' ? o.distanceModel : pa.distanceModel,
              maxDistance: typeof o.maxDistance !== 'undefined' ? o.maxDistance : pa.maxDistance,
              refDistance: typeof o.refDistance !== 'undefined' ? o.refDistance : pa.refDistance,
              rolloffFactor: typeof o.rolloffFactor !== 'undefined' ? o.rolloffFactor : pa.rolloffFactor,
              panningModel: typeof o.panningModel !== 'undefined' ? o.panningModel : pa.panningModel
            };

            // Update the panner values or create a new panner if none exists.
            var panner = sound._panner;
            if (panner) {
              panner.coneInnerAngle = pa.coneInnerAngle;
              panner.coneOuterAngle = pa.coneOuterAngle;
              panner.coneOuterGain = pa.coneOuterGain;
              panner.distanceModel = pa.distanceModel;
              panner.maxDistance = pa.maxDistance;
              panner.refDistance = pa.refDistance;
              panner.rolloffFactor = pa.rolloffFactor;
              panner.panningModel = pa.panningModel;
            } else {
              // Make sure we have a position to setup the node with.
              if (!sound._pos) {
                sound._pos = self._pos || [0, 0, -0.5];
              }

              // Create a new panner node.
              setupPanner(sound, 'spatial');
            }
          }
        }

        return self;
      };

      /** Single Sound Methods **/
      /***************************************************************************/

      /**
       * Add new properties to the core Sound init.
       * @param  {Function} _super Core Sound init method.
       * @return {Sound}
       */
      Sound.prototype.init = (function(_super) {
        return function() {
          var self = this;
          var parent = self._parent;

          // Setup user-defined default properties.
          self._orientation = parent._orientation;
          self._stereo = parent._stereo;
          self._pos = parent._pos;
          self._pannerAttr = parent._pannerAttr;

          // Complete initilization with howler.js core Sound's init function.
          _super.call(this);

          // If a stereo or position was specified, set it up.
          if (self._stereo) {
            parent.stereo(self._stereo);
          } else if (self._pos) {
            parent.pos(self._pos[0], self._pos[1], self._pos[2], self._id);
          }
        };
      })(Sound.prototype.init);

      /**
       * Override the Sound.reset method to clean up properties from the spatial plugin.
       * @param  {Function} _super Sound reset method.
       * @return {Sound}
       */
      Sound.prototype.reset = (function(_super) {
        return function() {
          var self = this;
          var parent = self._parent;

          // Reset all spatial plugin properties on this sound.
          self._orientation = parent._orientation;
          self._stereo = parent._stereo;
          self._pos = parent._pos;
          self._pannerAttr = parent._pannerAttr;

          // If a stereo or position was specified, set it up.
          if (self._stereo) {
            parent.stereo(self._stereo);
          } else if (self._pos) {
            parent.pos(self._pos[0], self._pos[1], self._pos[2], self._id);
          } else if (self._panner) {
            // Disconnect the panner.
            self._panner.disconnect(0);
            self._panner = undefined;
            parent._refreshBuffer(self);
          }

          // Complete resetting of the sound.
          return _super.call(this);
        };
      })(Sound.prototype.reset);

      /** Helper Methods **/
      /***************************************************************************/

      /**
       * Create a new panner node and save it on the sound.
       * @param  {Sound} sound Specific sound to setup panning on.
       * @param {String} type Type of panner to create: 'stereo' or 'spatial'.
       */
      var setupPanner = function(sound, type) {
        type = type || 'spatial';

        // Create the new panner node.
        if (type === 'spatial') {
          sound._panner = Howler.ctx.createPanner();
          sound._panner.coneInnerAngle = sound._pannerAttr.coneInnerAngle;
          sound._panner.coneOuterAngle = sound._pannerAttr.coneOuterAngle;
          sound._panner.coneOuterGain = sound._pannerAttr.coneOuterGain;
          sound._panner.distanceModel = sound._pannerAttr.distanceModel;
          sound._panner.maxDistance = sound._pannerAttr.maxDistance;
          sound._panner.refDistance = sound._pannerAttr.refDistance;
          sound._panner.rolloffFactor = sound._pannerAttr.rolloffFactor;
          sound._panner.panningModel = sound._pannerAttr.panningModel;

          if (typeof sound._panner.positionX !== 'undefined') {
            sound._panner.positionX.setValueAtTime(sound._pos[0], Howler.ctx.currentTime);
            sound._panner.positionY.setValueAtTime(sound._pos[1], Howler.ctx.currentTime);
            sound._panner.positionZ.setValueAtTime(sound._pos[2], Howler.ctx.currentTime);
          } else {
            sound._panner.setPosition(sound._pos[0], sound._pos[1], sound._pos[2]);
          }

          if (typeof sound._panner.orientationX !== 'undefined') {
            sound._panner.orientationX.setValueAtTime(sound._orientation[0], Howler.ctx.currentTime);
            sound._panner.orientationY.setValueAtTime(sound._orientation[1], Howler.ctx.currentTime);
            sound._panner.orientationZ.setValueAtTime(sound._orientation[2], Howler.ctx.currentTime);
          } else {
            sound._panner.setOrientation(sound._orientation[0], sound._orientation[1], sound._orientation[2]);
          }
        } else {
          sound._panner = Howler.ctx.createStereoPanner();
          sound._panner.pan.setValueAtTime(sound._stereo, Howler.ctx.currentTime);
        }

        sound._panner.connect(sound._node);

        // Update the connections.
        if (!sound._paused) {
          sound._parent.pause(sound._id, true).play(sound._id, true);
        }
      };
    })();
    });

    /* src/Vote.svelte generated by Svelte v3.32.1 */
    const file = "src/Vote.svelte";

    function create_fragment(ctx) {
    	let div3;
    	let div0;
    	let button0;
    	let span0;
    	let t1;
    	let div1;
    	let t2_value = /*person*/ ctx[0].name + "";
    	let t2;
    	let t3;
    	let t4_value = /*person*/ ctx[0].points + "";
    	let t4;
    	let t5;
    	let t6;
    	let div2;
    	let button1;
    	let span1;
    	let mounted;
    	let dispose;

    	const block = {
    		c: function create() {
    			div3 = element("div");
    			div0 = element("div");
    			button0 = element("button");
    			span0 = element("span");
    			span0.textContent = "+1";
    			t1 = space();
    			div1 = element("div");
    			t2 = text(t2_value);
    			t3 = text(" (");
    			t4 = text(t4_value);
    			t5 = text(")");
    			t6 = space();
    			div2 = element("div");
    			button1 = element("button");
    			span1 = element("span");
    			span1.textContent = "-1";
    			attr_dev(span0, "class", "mx-auto");
    			add_location(span0, file, 40, 6, 1167);
    			attr_dev(button0, "class", "w-32 bg-white tracking-wide text-gray-800 font-bold rounded border-b-2 border-green-500 hover:border-green-600 hover:bg-green-500 hover:text-white shadow-md py-2 px-6 inline-flex items-center");
    			add_location(button0, file, 38, 2, 903);
    			attr_dev(div0, "class", "m-3");
    			add_location(div0, file, 37, 1, 883);
    			attr_dev(div1, "class", "m-3 flex-grow text-center");
    			add_location(div1, file, 44, 1, 1221);
    			attr_dev(span1, "class", "mx-auto");
    			add_location(span1, file, 51, 6, 1594);
    			attr_dev(button1, "class", "w-32 bg-white tracking-wide text-gray-800 font-bold rounded border-b-2 border-red-500 hover:border-red-600 hover:bg-red-500 hover:text-white shadow-md py-2 px-6 inline-flex items-center");
    			add_location(button1, file, 49, 2, 1334);
    			attr_dev(div2, "class", "m-3");
    			add_location(div2, file, 48, 1, 1314);
    			attr_dev(div3, "class", "flex flex-row mt-5 mb-5 items-center");
    			add_location(div3, file, 36, 0, 831);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, div3, anchor);
    			append_dev(div3, div0);
    			append_dev(div0, button0);
    			append_dev(button0, span0);
    			append_dev(div3, t1);
    			append_dev(div3, div1);
    			append_dev(div1, t2);
    			append_dev(div1, t3);
    			append_dev(div1, t4);
    			append_dev(div1, t5);
    			append_dev(div3, t6);
    			append_dev(div3, div2);
    			append_dev(div2, button1);
    			append_dev(button1, span1);

    			if (!mounted) {
    				dispose = [
    					listen_dev(button0, "click", /*click_handler*/ ctx[3], false, false, false),
    					listen_dev(button1, "click", /*click_handler_1*/ ctx[4], false, false, false)
    				];

    				mounted = true;
    			}
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*person*/ 1 && t2_value !== (t2_value = /*person*/ ctx[0].name + "")) set_data_dev(t2, t2_value);
    			if (dirty & /*person*/ 1 && t4_value !== (t4_value = /*person*/ ctx[0].points + "")) set_data_dev(t4, t4_value);
    		},
    		i: noop,
    		o: noop,
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(div3);
    			mounted = false;
    			run_all(dispose);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots("Vote", slots, []);
    	let { person } = $$props;

    	function upvote(e, id) {
    		fetch(`/users/${id}/reward`, { method: "POST" }).then(r => r.json()).then(points => {
    			$$invalidate(0, person = points);
    		});

    		confetti({
    			particleCount: 100,
    			startVelocity: 30,
    			spread: 360
    		});
    	}

    	function downvote(e, id) {
    		fetch(`/users/${id}/reward?quantity=-1`, { method: "POST" }).then(r => r.json()).then(points => {
    			$$invalidate(0, person = points);
    		});

    		const mp3Idx = Math.floor(Math.random() * mp3.sound.length);
    		const oggIdx = Math.floor(Math.random() * ogg.sound.length);

    		const sound = new howler.Howl({
    				src: [mp3.prefix + mp3.sound[mp3Idx], ogg.prefix + ogg.sound[oggIdx]]
    			});

    		sound.play();
    	}

    	const writable_props = ["person"];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<Vote> was created with unknown prop '${key}'`);
    	});

    	const click_handler = e => {
    		upvote(e, person.id);
    	};

    	const click_handler_1 = e => {
    		downvote(e, person.id);
    	};

    	$$self.$$set = $$props => {
    		if ("person" in $$props) $$invalidate(0, person = $$props.person);
    	};

    	$$self.$capture_state = () => ({
    		person,
    		confetti,
    		mp3,
    		ogg,
    		Howl: howler.Howl,
    		upvote,
    		downvote
    	});

    	$$self.$inject_state = $$props => {
    		if ("person" in $$props) $$invalidate(0, person = $$props.person);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [person, upvote, downvote, click_handler, click_handler_1];
    }

    class Vote extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance, create_fragment, safe_not_equal, { person: 0 });

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "Vote",
    			options,
    			id: create_fragment.name
    		});

    		const { ctx } = this.$$;
    		const props = options.props || {};

    		if (/*person*/ ctx[0] === undefined && !("person" in props)) {
    			console.warn("<Vote> was created without expected prop 'person'");
    		}
    	}

    	get person() {
    		throw new Error("<Vote>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}

    	set person(value) {
    		throw new Error("<Vote>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
    	}
    }

    /* src/App.svelte generated by Svelte v3.32.1 */
    const file$1 = "src/App.svelte";

    function get_each_context(ctx, list, i) {
    	const child_ctx = ctx.slice();
    	child_ctx[1] = list[i];
    	return child_ctx;
    }

    // (184518:2) {#each points as i}
    function create_each_block(ctx) {
    	let li;
    	let vote;
    	let t;
    	let current;

    	vote = new Vote({
    			props: { person: /*i*/ ctx[1] },
    			$$inline: true
    		});

    	const block = {
    		c: function create() {
    			li = element("li");
    			create_component(vote.$$.fragment);
    			t = space();
    			attr_dev(li, "class", "border-b border-gray-200 last:border-b-0");
    			add_location(li, file$1, 184518, 3, 4346709);
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, li, anchor);
    			mount_component(vote, li, null);
    			append_dev(li, t);
    			current = true;
    		},
    		p: function update(ctx, dirty) {
    			const vote_changes = {};
    			if (dirty & /*points*/ 1) vote_changes.person = /*i*/ ctx[1];
    			vote.$set(vote_changes);
    		},
    		i: function intro(local) {
    			if (current) return;
    			transition_in(vote.$$.fragment, local);
    			current = true;
    		},
    		o: function outro(local) {
    			transition_out(vote.$$.fragment, local);
    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(li);
    			destroy_component(vote);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_each_block.name,
    		type: "each",
    		source: "(184518:2) {#each points as i}",
    		ctx
    	});

    	return block;
    }

    function create_fragment$1(ctx) {
    	let main;
    	let h1;
    	let t1;
    	let ul;
    	let current;
    	let each_value = /*points*/ ctx[0];
    	validate_each_argument(each_value);
    	let each_blocks = [];

    	for (let i = 0; i < each_value.length; i += 1) {
    		each_blocks[i] = create_each_block(get_each_context(ctx, each_value, i));
    	}

    	const out = i => transition_out(each_blocks[i], 1, 1, () => {
    		each_blocks[i] = null;
    	});

    	const block = {
    		c: function create() {
    			main = element("main");
    			h1 = element("h1");
    			h1.textContent = "Hello You";
    			t1 = space();
    			ul = element("ul");

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].c();
    			}

    			add_location(h1, file$1, 184515, 1, 4346659);
    			add_location(ul, file$1, 184516, 1, 4346679);
    			attr_dev(main, "class", "h-screen flex flex-col max-w-sm items-center m-auto text-center justify-center");
    			add_location(main, file$1, 184513, 0, 4346563);
    		},
    		l: function claim(nodes) {
    			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
    		},
    		m: function mount(target, anchor) {
    			insert_dev(target, main, anchor);
    			append_dev(main, h1);
    			append_dev(main, t1);
    			append_dev(main, ul);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				each_blocks[i].m(ul, null);
    			}

    			current = true;
    		},
    		p: function update(ctx, [dirty]) {
    			if (dirty & /*points*/ 1) {
    				each_value = /*points*/ ctx[0];
    				validate_each_argument(each_value);
    				let i;

    				for (i = 0; i < each_value.length; i += 1) {
    					const child_ctx = get_each_context(ctx, each_value, i);

    					if (each_blocks[i]) {
    						each_blocks[i].p(child_ctx, dirty);
    						transition_in(each_blocks[i], 1);
    					} else {
    						each_blocks[i] = create_each_block(child_ctx);
    						each_blocks[i].c();
    						transition_in(each_blocks[i], 1);
    						each_blocks[i].m(ul, null);
    					}
    				}

    				group_outros();

    				for (i = each_value.length; i < each_blocks.length; i += 1) {
    					out(i);
    				}

    				check_outros();
    			}
    		},
    		i: function intro(local) {
    			if (current) return;

    			for (let i = 0; i < each_value.length; i += 1) {
    				transition_in(each_blocks[i]);
    			}

    			current = true;
    		},
    		o: function outro(local) {
    			each_blocks = each_blocks.filter(Boolean);

    			for (let i = 0; i < each_blocks.length; i += 1) {
    				transition_out(each_blocks[i]);
    			}

    			current = false;
    		},
    		d: function destroy(detaching) {
    			if (detaching) detach_dev(main);
    			destroy_each(each_blocks, detaching);
    		}
    	};

    	dispatch_dev("SvelteRegisterBlock", {
    		block,
    		id: create_fragment$1.name,
    		type: "component",
    		source: "",
    		ctx
    	});

    	return block;
    }

    function instance$1($$self, $$props, $$invalidate) {
    	let { $$slots: slots = {}, $$scope } = $$props;
    	validate_slots("App", slots, []);
    	let points = [];

    	onMount(async () => {
    		$$invalidate(0, points = await fetch(`/users`).then(r => r.json()).then(points => {
    			return points.items;
    		}));
    	});

    	const writable_props = [];

    	Object.keys($$props).forEach(key => {
    		if (!~writable_props.indexOf(key) && key.slice(0, 2) !== "$$") console.warn(`<App> was created with unknown prop '${key}'`);
    	});

    	$$self.$capture_state = () => ({ points, Vote, onMount });

    	$$self.$inject_state = $$props => {
    		if ("points" in $$props) $$invalidate(0, points = $$props.points);
    	};

    	if ($$props && "$$inject" in $$props) {
    		$$self.$inject_state($$props.$$inject);
    	}

    	return [points];
    }

    class App extends SvelteComponentDev {
    	constructor(options) {
    		super(options);
    		init(this, options, instance$1, create_fragment$1, safe_not_equal, {});

    		dispatch_dev("SvelteRegisterComponent", {
    			component: this,
    			tagName: "App",
    			options,
    			id: create_fragment$1.name
    		});
    	}
    }

    const app = new App({
    	target: document.body,
    	props: {
    		name: 'world'
    	}
    });

    return app;

}());
//# sourceMappingURL=bundle.js.map

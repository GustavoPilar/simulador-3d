/**
 * Controles do modo construção: vistas 3D (órbita) e Planta (ortográfica), gizmo de mover/girar,
 * seleção por clique, encaixe em paredes e ferramentas de clique no piso
 * (desenhar paredes, trena, calibrar e alinhar a planta de fundo).
 */
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

import { SNAP_DISTANCE_3D, SNAP_PIXELS } from '../core/config.js';
import { snapToWalls } from '../core/geometry.js';
import { formatMeters, roundToStep } from '../core/units.js';
import { createTextSprite } from './labels.js';
import { disposeObject } from './materials.js';
import { SceneManager } from './scene.js';
import { WorldBuilder } from './world.js';

/** Deslocamento máximo do ponteiro (px) para um gesto ainda contar como clique e não como arrasto. */
const CLICK_TOLERANCE = 5;

/** Altura visível (m) a 1 m de distância na câmera 3D de 50°: referência dos rótulos na vista Planta. */
const LABEL_REFERENCE_HEIGHT = 2 * Math.tan(THREE.MathUtils.degToRad(25));

/** Cores do marcador do cursor conforme o encaixe. */
const SNAP_COLORS = Object.freeze({ corner: '#1f9d55', face: '#2b7bd6', none: '#ff7a00' });

/**
 * @typedef {{type: string, id: string}} EntityRef
 * @typedef {null|'wall'|'measure'|'calibrate'|'align'} ToolName
 * @typedef {{point: THREE.Vector3, kind: 'corner'|'face'|null}} FloorPick
 */

export class BuildControls {
    // #region Construtores :: constructor()

    /**
     * @param {SceneManager} sceneManager Cena.
     * @param {WorldBuilder} world Mundo 3D.
     */
    constructor(sceneManager, world) {
        /** @type {SceneManager} */
        this.sceneManager = sceneManager;
        /** @type {WorldBuilder} */
        this.world = world;
        /** @type {HTMLCanvasElement} */
        this.canvas = sceneManager.renderer.domElement;
        /** @type {'3d'|'plan'} */
        this.view = '3d';

        /** @type {OrbitControls} */
        this.orbit = new OrbitControls(sceneManager.buildCamera, this.canvas);
        this.orbit.enableDamping = true;
        this.orbit.dampingFactor = 0.12;
        this.orbit.maxPolarAngle = Math.PI * 0.495;
        this.orbit.minDistance = 0.4;
        this.orbit.maxDistance = 400;
        this.orbit.screenSpacePanning = false;

        /** @type {OrbitControls} Na Planta, arrastar desloca a vista; a roda aproxima. */
        this.planOrbit = new OrbitControls(sceneManager.planCamera, this.canvas);
        this.planOrbit.enableRotate = false;
        this.planOrbit.screenSpacePanning = true;
        this.planOrbit.minZoom = 0.05;
        this.planOrbit.maxZoom = 60;
        this.planOrbit.mouseButtons = { LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };
        this.planOrbit.enabled = false;

        /** @type {TransformControls} */
        this.transform = new TransformControls(sceneManager.buildCamera, this.canvas);
        this.transform.setSize(0.85);
        sceneManager.scene.add(this.transform.getHelper());

        /** @type {THREE.Raycaster} */
        this.raycaster = new THREE.Raycaster();
        /** @type {THREE.Plane} */
        this.floorPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
        /** @type {{x: number, y: number}|null} */
        this.pointerDown = null;
        /** @type {{x: number, y: number}|null} */
        this.rightDown = null;
        /** @type {boolean} */
        this.enabled = true;
        /** @type {'translate'|'rotate'} */
        this.gizmoMode = 'translate';
        /** @type {number|null} */
        this.snapStep = 1;
        /** @type {{points: Array<{x: number, z: number}>, segments: Array<{ax: number, az: number, bx: number, bz: number}>}} */
        this.snapTargets = { points: [], segments: [] };
        /** @type {EntityRef|null} */
        this.attachedRef = null;
        /** @type {THREE.BoxHelper|null} */
        this.highlight = null;
        /** @type {boolean} Rótulos estão na escala da vista Planta. */
        this.labelsScaled = false;

        /** @type {ToolName} */
        this.tool = null;
        /** @type {THREE.Vector3|null} */
        this.toolStart = null;
        /** @type {THREE.Group} */
        this.preview = new THREE.Group();
        /** @type {THREE.Group} Medidas da trena (permanecem até limpar). */
        this.measurements = new THREE.Group();
        sceneManager.scene.add(this.preview, this.measurements);

        /** @type {(ref: EntityRef|null) => void} */
        this.onSelect = () => {};
        /** @type {(ref: EntityRef, root: THREE.Object3D) => void} */
        this.onTransformChange = () => {};
        /** @type {(ref: EntityRef, root: THREE.Object3D) => void} */
        this.onTransformCommit = () => {};
        /** @type {(start: THREE.Vector3, end: THREE.Vector3) => void} */
        this.onWallDrawn = () => {};
        /** @type {(pick: FloorPick|null) => void} */
        this.onPointerFloor = () => {};
        /** @type {(tool: ToolName) => void} */
        this.onToolChange = () => {};
        /** @type {(a: THREE.Vector3, b: THREE.Vector3) => void} */
        this.onCalibrate = () => {};
        /** @type {(point: THREE.Vector3) => void} */
        this.onAlign = () => {};

        this.bindEvents();
        sceneManager.addUpdater(() => this.update());
    }

    // #endregion

    // #region Propriedades :: camera

    /** @returns {THREE.Camera} Câmera da vista ativa do modo construção. */
    get camera() {
        return this.view === 'plan' ? this.sceneManager.planCamera : this.sceneManager.buildCamera;
    }

    // #endregion

    // #region Configuração :: bindEvents(), setEnabled(), setView(), setSnap(), setSnapTargets(), setGizmoMode(), frameEnvironment()

    /**
     * Registra os eventos de ponteiro e do gizmo.
     */
    bindEvents() {
        this.transform.addEventListener('dragging-changed', (event) => {
            this.orbit.enabled = !event.value && this.enabled && this.view === '3d';
            this.planOrbit.enabled = !event.value && this.enabled && this.view === 'plan';
        });
        this.transform.addEventListener('objectChange', () => {
            if (this.attachedRef !== null && this.transform.object !== undefined) {
                this.highlight?.update();
                this.onTransformChange(this.attachedRef, this.transform.object);
            }
        });
        this.transform.addEventListener('mouseUp', () => {
            if (this.attachedRef !== null && this.transform.object !== undefined) {
                this.onTransformCommit(this.attachedRef, this.transform.object);
            }
        });

        this.canvas.addEventListener('pointerdown', (event) => {
            if (event.button === 0) {
                this.pointerDown = { x: event.clientX, y: event.clientY };
            } else if (event.button === 2) {
                this.rightDown = { x: event.clientX, y: event.clientY };
            }
        });
        this.canvas.addEventListener('pointermove', (event) => {
            if (!this.enabled) {
                return;
            }
            /** @type {FloorPick|null} */
            const pick = this.pickFloor(event, this.usesSnap());
            this.onPointerFloor(pick);
            if (this.tool !== null) {
                this.updatePreview(pick);
            }
        });
        this.canvas.addEventListener('pointerleave', () => this.onPointerFloor(null));
        this.canvas.addEventListener('pointerup', (event) => this.handlePointerUp(event));
        this.canvas.addEventListener('contextmenu', (event) => {
            event.preventDefault();
            /** @type {boolean} */
            const wasClick = this.rightDown !== null && Math.hypot(event.clientX - this.rightDown.x, event.clientY - this.rightDown.y) <= CLICK_TOLERANCE;
            this.rightDown = null;
            // Clique direito sem arrastar encerra a ferramenta; arrastar com o botão direito apenas desloca a vista
            if (this.tool !== null && wasClick) {
                this.stopTool();
            }
        });
    }

    /**
     * @param {boolean} enabled Liga ou desliga os controles (desligados no modo explorar).
     */
    setEnabled(enabled) {
        this.enabled = enabled;
        this.orbit.enabled = enabled && this.view === '3d';
        this.planOrbit.enabled = enabled && this.view === 'plan';
        this.transform.enabled = enabled;
        this.preview.visible = enabled;
        this.measurements.visible = enabled;
        if (!enabled) {
            this.stopTool();
        }
    }

    /**
     * Alterna entre a vista 3D e a vista Planta (de cima, com o topo da imagem para -Z).
     * @param {'3d'|'plan'} view Vista.
     */
    setView(view) {
        this.view = view;
        this.transform.camera = this.camera;
        this.orbit.enabled = this.enabled && view === '3d';
        this.planOrbit.enabled = this.enabled && view === 'plan';
        this.sceneManager.useCamera('build', view);
    }

    /**
     * @param {number|null} step Passo da grade para encaixe, ou null para movimento livre.
     */
    setSnap(step) {
        this.snapStep = step;
        this.transform.setTranslationSnap(step);
        this.transform.setRotationSnap(step === null ? null : THREE.MathUtils.degToRad(15));
    }

    /**
     * @param {{points: Array<{x: number, z: number}>, segments: Array<{ax: number, az: number, bx: number, bz: number}>}} targets Cantos e faces de paredes.
     */
    setSnapTargets(targets) {
        this.snapTargets = targets;
    }

    /**
     * @param {'translate'|'rotate'} mode Modo do gizmo.
     */
    setGizmoMode(mode) {
        this.gizmoMode = mode;
        if (this.attachedRef !== null) {
            this.configureGizmo(this.attachedRef);
        }
    }

    /**
     * Enquadra o ambiente nas duas vistas.
     * @param {{width: number, length: number, height: number}} env Dimensões.
     */
    frameEnvironment(env) {
        /** @type {number} */
        const span = Math.max(env.width, env.length, env.height);
        /** @type {THREE.PerspectiveCamera} */
        const camera = this.sceneManager.buildCamera;
        this.orbit.target.set(env.width / 2, 0, env.length / 2);
        // Vista alta (≈55°) para que as paredes próximas não escondam o interior
        camera.position.set(env.width / 2 + span * 0.45, span * 1.35 + 2, env.length / 2 + span * 0.95 + 1);
        camera.lookAt(this.orbit.target);
        this.orbit.update();

        this.framePlan(0, 0, env.width, env.length);
    }

    /**
     * Enquadra um retângulo do piso na vista Planta, com margem.
     * @param {number} minX Limite esquerdo.
     * @param {number} minZ Limite superior.
     * @param {number} maxX Limite direito.
     * @param {number} maxZ Limite inferior.
     */
    framePlan(minX, minZ, maxX, maxZ) {
        /** @type {THREE.OrthographicCamera} */
        const plan = this.sceneManager.planCamera;
        /** @type {number} */
        const aspect = Math.max(1, this.canvas.clientWidth) / Math.max(1, this.canvas.clientHeight);
        /** @type {number} */
        const centerX = (minX + maxX) / 2;
        /** @type {number} */
        const centerZ = (minZ + maxZ) / 2;
        this.sceneManager.planHalfHeight = Math.max((maxZ - minZ) / 2, (maxX - minX) / 2 / aspect) + 1.2;
        this.sceneManager.updatePlanFrustum();
        plan.zoom = 1;
        plan.position.set(centerX, 100, centerZ);
        plan.lookAt(centerX, 0, centerZ);
        plan.updateProjectionMatrix();
        this.planOrbit.target.set(centerX, 0, centerZ);
        this.planOrbit.update();
    }

    // #endregion

    // #region Seleção :: handlePointerUp(), pick(), pickFloor(), usesSnap(), setRayFromEvent(), attach(), detach(), configureGizmo(), update(), updateLabelScale()

    /**
     * @param {PointerEvent} event Evento do ponteiro.
     */
    handlePointerUp(event) {
        if (!this.enabled || event.button !== 0 || this.pointerDown === null) {
            return;
        }
        /** @type {number} */
        const moved = Math.hypot(event.clientX - this.pointerDown.x, event.clientY - this.pointerDown.y);
        this.pointerDown = null;
        // Arrastos movem a câmera ou o gizmo; só cliques curtos selecionam ou usam ferramentas
        if (moved > CLICK_TOLERANCE || this.transform.dragging || this.transform.axis !== null) {
            return;
        }
        if (this.tool !== null) {
            /** @type {FloorPick|null} */
            const pick = this.pickFloor(event, this.usesSnap());
            if (pick !== null) {
                this.handleToolClick(pick.point);
            }
            return;
        }
        this.onSelect(this.pick(event));
    }

    /**
     * @param {MouseEvent} event Evento.
     * @returns {EntityRef|null} Entidade sob o cursor.
     */
    pick(event) {
        this.setRayFromEvent(event);
        /** @type {THREE.Intersection[]} */
        const hits = this.raycaster.intersectObjects(this.world.selectables, false);
        for (const hit of hits) {
            /** @type {boolean} */
            let visible = true;
            hit.object.traverseAncestors((ancestor) => {
                visible = visible && ancestor.visible;
            });
            if (visible) {
                return /** @type {EntityRef} */ (hit.object.userData.selectable);
            }
        }
        return null;
    }

    /**
     * Ponto do piso sob o cursor. Com encaixe, prioriza cantos e faces de paredes; depois, a grade.
     * @param {MouseEvent} event Evento.
     * @param {boolean} snap Aplicar encaixe.
     * @returns {FloorPick|null} Ponto e tipo de encaixe.
     */
    pickFloor(event, snap) {
        this.setRayFromEvent(event);
        /** @type {THREE.Vector3} */
        const point = new THREE.Vector3();
        if (this.raycaster.ray.intersectPlane(this.floorPlane, point) === null) {
            return null;
        }
        if (!snap) {
            return { point, kind: null };
        }
        /** @type {number} */
        const threshold = this.view === 'plan' ? SNAP_PIXELS * this.sceneManager.getPlanMetersPerPixel() : SNAP_DISTANCE_3D;
        /** @type {{point: {x: number, z: number}, kind: 'corner'|'face'|null}} */
        const snapped = snapToWalls({ x: point.x, z: point.z }, this.snapTargets, threshold);
        if (snapped.kind !== null) {
            return { point: new THREE.Vector3(snapped.point.x, 0, snapped.point.z), kind: snapped.kind };
        }
        if (this.snapStep !== null) {
            point.x = roundToStep(point.x, this.snapStep);
            point.z = roundToStep(point.z, this.snapStep);
        }
        return { point, kind: null };
    }

    /**
     * Calibrar e alinhar usam o ponto exato da imagem; as demais ferramentas encaixam.
     * @returns {boolean} Verdadeiro se o encaixe deve ser aplicado.
     */
    usesSnap() {
        return this.tool !== 'calibrate' && this.tool !== 'align';
    }

    /**
     * @param {MouseEvent} event Evento.
     */
    setRayFromEvent(event) {
        /** @type {DOMRect} */
        const rect = this.canvas.getBoundingClientRect();
        /** @type {THREE.Vector2} */
        const ndc = new THREE.Vector2(
            ((event.clientX - rect.left) / rect.width) * 2 - 1,
            -((event.clientY - rect.top) / rect.height) * 2 + 1
        );
        this.raycaster.setFromCamera(ndc, this.camera);
    }

    /**
     * Destaca a entidade e anexa o gizmo quando ela pode ser movida.
     * @param {EntityRef|null} ref Entidade.
     * @param {boolean} movable Falso para paredes externas.
     */
    attach(ref, movable) {
        this.detach();
        if (ref === null) {
            return;
        }
        /** @type {THREE.Object3D|null} */
        const root = this.world.getRoot(ref.type, ref.id);
        if (root === null) {
            return;
        }
        this.attachedRef = ref;
        this.highlight = new THREE.BoxHelper(root, '#ff7a00');
        /** @type {THREE.Material} */
        const material = /** @type {THREE.Material} */ (this.highlight.material);
        material.depthTest = false;
        material.transparent = true;
        this.highlight.renderOrder = 998;
        this.sceneManager.scene.add(this.highlight);
        if (movable) {
            this.transform.attach(root);
            this.configureGizmo(ref);
        }
    }

    /**
     * Remove destaque e gizmo.
     */
    detach() {
        this.transform.detach();
        this.attachedRef = null;
        if (this.highlight !== null) {
            this.sceneManager.scene.remove(this.highlight);
            this.highlight.geometry.dispose();
            /** @type {THREE.Material} */ (this.highlight.material).dispose();
            this.highlight = null;
        }
    }

    /**
     * Restringe os eixos do gizmo conforme o tipo de entidade.
     * @param {EntityRef} ref Entidade.
     */
    configureGizmo(ref) {
        /** @type {boolean} */
        const isOpening = ref.type === 'door' || ref.type === 'window';
        /** @type {boolean} */
        const rotating = this.gizmoMode === 'rotate' && !isOpening && ref.type !== 'room';
        this.transform.setMode(rotating ? 'rotate' : 'translate');
        this.transform.setSpace(isOpening ? 'local' : 'world');
        this.transform.showX = !rotating;
        this.transform.showZ = !rotating && !isOpening;
        // Na Planta o eixo vertical aponta para a câmera e não pode ser arrastado
        this.transform.showY = rotating || (ref.type === 'object' && this.view === '3d');
    }

    /**
     * Atualização por quadro.
     */
    update() {
        if (!this.enabled) {
            return;
        }
        if (this.view === '3d') {
            this.orbit.update();
        } else {
            this.planOrbit.update();
        }
        this.updateLabelScale();
    }

    /**
     * Na vista ortográfica, rótulos com tamanho fixo de tela precisam ser escalados pelo zoom.
     * @param {boolean} [forcePlan=false] Aplicar a escala da Planta mesmo fora dela (exportação da folha).
     */
    updateLabelScale(forcePlan = false) {
        /** @type {boolean} */
        const plan = forcePlan || this.view === 'plan';
        if (!plan && !this.labelsScaled) {
            return;
        }
        /** @type {THREE.OrthographicCamera} */
        const camera = this.sceneManager.planCamera;
        /** @type {number} */
        const factor = plan ? (2 * this.sceneManager.planHalfHeight) / camera.zoom / LABEL_REFERENCE_HEIGHT : 1;
        this.sceneManager.scene.traverse((child) => {
            if (child instanceof THREE.Sprite && child.userData.baseScale !== undefined) {
                child.scale.set(child.userData.baseScale.x * factor, child.userData.baseScale.y * factor, 1);
            }
        });
        this.labelsScaled = plan;
    }

    // #endregion

    // #region Ferramentas :: startTool(), stopTool(), handleToolClick(), clearMeasurements(), updatePreview(), buildSegmentPreview()

    /**
     * Ativa uma ferramenta de clique no piso.
     * @param {Exclude<ToolName, null>} tool Ferramenta.
     */
    startTool(tool) {
        this.stopTool();
        this.tool = tool;
        this.toolStart = null;
        this.onSelect(null);
        this.canvas.style.cursor = 'crosshair';
        this.onToolChange(tool);
    }

    /**
     * Encerra a ferramenta ativa.
     */
    stopTool() {
        if (this.tool === null) {
            return;
        }
        this.tool = null;
        this.toolStart = null;
        this.updatePreview(null);
        this.canvas.style.cursor = '';
        this.onToolChange(null);
    }

    /**
     * @param {THREE.Vector3} point Ponto clicado no piso.
     */
    handleToolClick(point) {
        switch (this.tool) {
            case 'align':
                this.onAlign(point.clone());
                this.stopTool();
                return;
            case 'wall':
                if (this.toolStart !== null && this.toolStart.distanceTo(point) >= 0.05) {
                    this.onWallDrawn(this.toolStart.clone(), point.clone());
                }
                // Paredes são encadeadas: o fim de uma é o início da próxima
                this.toolStart = point.clone();
                return;
            case 'measure':
                if (this.toolStart === null) {
                    this.toolStart = point.clone();
                } else {
                    this.measurements.add(this.buildSegmentPreview(this.toolStart, point, '#1e2930'));
                    this.toolStart = null;
                }
                return;
            case 'calibrate':
                if (this.toolStart === null) {
                    this.toolStart = point.clone();
                } else {
                    /** @type {THREE.Vector3} */
                    const start = this.toolStart.clone();
                    this.stopTool();
                    this.onCalibrate(start, point.clone());
                }
                return;
            default:
                return;
        }
    }

    /**
     * Remove as medidas feitas com a trena.
     */
    clearMeasurements() {
        for (const child of [...this.measurements.children]) {
            this.measurements.remove(child);
            disposeObject(child);
        }
    }

    /**
     * Mostra o marcador do cursor e o segmento em construção com sua medida.
     * @param {FloorPick|null} pick Ponto atual.
     */
    updatePreview(pick) {
        for (const child of [...this.preview.children]) {
            this.preview.remove(child);
            disposeObject(child);
        }
        if (pick === null || this.tool === null) {
            return;
        }
        /** @type {string} */
        const color = SNAP_COLORS[pick.kind ?? 'none'];
        /** @type {number} */
        const markerSize = this.view === 'plan' ? 8 * this.sceneManager.getPlanMetersPerPixel() : 0.1;
        /** @type {THREE.MeshBasicMaterial} */
        const markerMaterial = new THREE.MeshBasicMaterial({ color, depthTest: false });
        markerMaterial.userData.owned = true;
        /** @type {THREE.Mesh} */
        const marker = new THREE.Mesh(new THREE.RingGeometry(markerSize * 0.55, markerSize, 24), markerMaterial);
        marker.rotation.x = -Math.PI / 2;
        marker.position.set(pick.point.x, 0.02, pick.point.z);
        marker.renderOrder = 1001;
        this.preview.add(marker);
        if (this.toolStart !== null) {
            this.preview.add(this.buildSegmentPreview(this.toolStart, pick.point, color));
        }
    }

    /**
     * @param {THREE.Vector3} start Início.
     * @param {THREE.Vector3} end Fim.
     * @param {string} color Cor.
     * @returns {THREE.Group} Linha com rótulo de comprimento.
     */
    buildSegmentPreview(start, end, color) {
        /** @type {THREE.Group} */
        const group = new THREE.Group();
        /** @type {THREE.LineBasicMaterial} */
        const material = new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true });
        material.userData.owned = true;
        /** @type {THREE.Line} */
        const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([start.clone().setY(0.02), end.clone().setY(0.02)]), material);
        line.renderOrder = 1001;
        group.add(line);
        /** @type {THREE.Sprite} */
        const label = createTextSprite(formatMeters(start.distanceTo(end)));
        label.position.copy(start).add(end).multiplyScalar(0.5).setY(0.3);
        group.add(label);
        return group;
    }

    // #endregion
}

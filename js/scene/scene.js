/**
 * Renderizador, câmeras, iluminação e loop de animação.
 */
import * as THREE from 'three';

/** Intervalo máximo entre quadros: evita "teleportes" quando a aba volta do segundo plano. */
const MAX_FRAME_TIME = 0.05;

export class SceneManager {
    // #region Construtores :: constructor()

    /**
     * @param {HTMLElement} container Elemento que recebe o canvas.
     */
    constructor(container) {
        /** @type {HTMLElement} */
        this.container = container;
        /** @type {THREE.WebGLRenderer} */
        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        this.renderer.shadowMap.enabled = true;
        this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
        // O mapeamento de tons evita que superfícies claras (colchões, paredes) estourem para branco puro
        this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
        this.renderer.toneMappingExposure = 1.0;
        // Corte horizontal por material (forros e tetos somem ao olhar de cima)
        this.renderer.localClippingEnabled = true;
        this.renderer.domElement.tabIndex = 0;
        container.appendChild(this.renderer.domElement);

        /** @type {THREE.Scene} */
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color('#d6dbd3');

        /** @type {THREE.PerspectiveCamera} */
        this.buildCamera = new THREE.PerspectiveCamera(50, 1, 0.05, 2000);
        /** @type {THREE.PerspectiveCamera} */
        this.fpsCamera = new THREE.PerspectiveCamera(70, 1, 0.03, 1000);
        this.fpsCamera.rotation.order = 'YXZ';
        /** @type {THREE.OrthographicCamera} Vista Planta: olha de cima com -Z para cima, igual a uma imagem. */
        this.planCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
        this.planCamera.up.set(0, 0, -1);
        /** @type {number} Meia altura visível da vista Planta (m) com zoom 1. */
        this.planHalfHeight = 5;
        /** @type {THREE.Camera} */
        this.activeCamera = this.buildCamera;

        /** @type {THREE.HemisphereLight} */
        this.hemisphere = new THREE.HemisphereLight('#f6f8fb', '#8c8473', 1.5);
        /** @type {THREE.DirectionalLight} */
        this.sun = new THREE.DirectionalLight('#fff6e8', 1.8);
        this.sun.castShadow = true;
        this.sun.shadow.mapSize.set(2048, 2048);
        this.sun.shadow.bias = -0.0004;
        this.sun.shadow.normalBias = 0.02;
        /** @type {THREE.PointLight} */
        this.roomLight = new THREE.PointLight('#fff1dc', 3, 0, 2);
        this.scene.add(this.hemisphere, this.sun, this.sun.target, this.roomLight);

        /** @type {THREE.Clock} */
        this.clock = new THREE.Clock();
        /** @type {Set<(delta: number) => void>} */
        this.updaters = new Set();
        /** @type {ResizeObserver} */
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(container);
        this.resize();
        this.renderer.setAnimationLoop(() => this.tick());
    }

    // #endregion

    // #region Ciclo :: addUpdater(), tick(), resize()

    /**
     * Registra uma função chamada a cada quadro com o tempo decorrido em segundos.
     * @param {(delta: number) => void} updater Função de atualização.
     */
    addUpdater(updater) {
        this.updaters.add(updater);
    }

    /**
     * Executa um quadro: atualizações e renderização.
     */
    tick() {
        /** @type {number} */
        const delta = Math.min(this.clock.getDelta(), MAX_FRAME_TIME);
        for (const updater of this.updaters) {
            updater(delta);
        }
        this.renderer.render(this.scene, this.activeCamera);
    }

    /**
     * Ajusta o renderizador e as câmeras ao tamanho do contêiner.
     */
    resize() {
        /** @type {number} */
        const width = Math.max(1, this.container.clientWidth);
        /** @type {number} */
        const height = Math.max(1, this.container.clientHeight);
        this.renderer.setSize(width, height, false);
        for (const camera of [this.buildCamera, this.fpsCamera]) {
            camera.aspect = width / height;
            camera.updateProjectionMatrix();
        }
        this.updatePlanFrustum();
    }

    // #endregion

    // #region Configuração :: useCamera(), fitLights()

    /**
     * @param {'build'|'explore'} mode Modo ativo.
     * @param {'3d'|'plan'} [view='3d'] Vista do modo construção.
     */
    useCamera(mode, view = '3d') {
        if (mode === 'explore') {
            this.activeCamera = this.fpsCamera;
        } else {
            this.activeCamera = view === 'plan' ? this.planCamera : this.buildCamera;
        }
    }

    /**
     * Recalcula o volume visível da câmera ortográfica mantendo a proporção da tela.
     */
    updatePlanFrustum() {
        /** @type {number} */
        const aspect = Math.max(1, this.container.clientWidth) / Math.max(1, this.container.clientHeight);
        this.planCamera.top = this.planHalfHeight;
        this.planCamera.bottom = -this.planHalfHeight;
        this.planCamera.left = -this.planHalfHeight * aspect;
        this.planCamera.right = this.planHalfHeight * aspect;
        this.planCamera.updateProjectionMatrix();
    }

    /**
     * @returns {number} Metros por pixel na vista Planta (considera o zoom).
     */
    getPlanMetersPerPixel() {
        return (2 * this.planHalfHeight) / this.planCamera.zoom / Math.max(1, this.container.clientHeight);
    }

    /**
     * Posiciona o sol e a luz interna conforme o tamanho do ambiente, cobrindo-o com a área de sombra.
     * @param {{width: number, length: number, height: number}} env Dimensões internas.
     */
    fitLights(env) {
        /** @type {number} */
        const span = Math.max(env.width, env.length);
        /** @type {THREE.Vector3} */
        const center = new THREE.Vector3(env.width / 2, 0, env.length / 2);
        this.sun.position.set(center.x - span * 0.6, Math.max(env.height * 3, span * 1.2), center.z - span * 0.9);
        this.sun.target.position.copy(center);
        /** @type {THREE.OrthographicCamera} */
        const shadowCamera = this.sun.shadow.camera;
        /** @type {number} */
        const extent = span * 0.85 + 2;
        shadowCamera.left = -extent;
        shadowCamera.right = extent;
        shadowCamera.top = extent;
        shadowCamera.bottom = -extent;
        shadowCamera.near = 0.5;
        shadowCamera.far = span * 4 + env.height * 6;
        shadowCamera.updateProjectionMatrix();
        // Abaixo do teto para não criar um ponto estourado; a intensidade cresce com o tamanho (decaimento quadrático)
        this.roomLight.position.set(center.x, env.height * 0.8, center.z);
        this.roomLight.intensity = 1.5 + span * 0.6;
    }

    // #endregion
}

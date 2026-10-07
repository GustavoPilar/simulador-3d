/**
 * Controlador em primeira pessoa: captura do cursor (Pointer Lock), movimentação WASD,
 * corrida, pulo, gravidade e colisões com o ambiente.
 */
import * as THREE from 'three';

import { PHYSICS } from '../core/config.js';
import { CollisionWorld } from '../core/collision.js';
import { Logger } from '../core/logger.js';
import { degToRad } from '../core/units.js';

/**
 * @typedef {Object} PlayerSettings
 * @property {number} height
 * @property {number} width
 * @property {number} depth
 * @property {number} walkSpeed
 * @property {number} runSpeed
 * @property {number} fov
 */

/**
 * @typedef {Object} PlayerStatus
 * @property {number} x
 * @property {number} z
 * @property {number} eyeHeight
 * @property {boolean} running
 * @property {string|null} target Nome do elemento interativo sob a mira.
 */

/** Teclas de movimento tratadas pelo controlador. */
const MOVEMENT_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight', 'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

export class FirstPersonController {
    // #region Construtores :: constructor()

    /**
     * @param {THREE.PerspectiveCamera} camera Câmera em primeira pessoa.
     * @param {HTMLElement} element Elemento que captura o cursor.
     * @param {CollisionWorld} collisionWorld Mundo de colisão.
     */
    constructor(camera, element, collisionWorld) {
        /** @type {THREE.PerspectiveCamera} */
        this.camera = camera;
        /** @type {HTMLElement} */
        this.element = element;
        /** @type {CollisionWorld} */
        this.collisionWorld = collisionWorld;
        /** @type {Logger} */
        this.logger = new Logger('player');

        /** @type {PlayerSettings} */
        this.settings = { height: 1.75, width: 0.45, depth: 0.3, walkSpeed: 1.4, runSpeed: 3, fov: 70 };
        /** @type {{x: number, y: number, z: number}} Posição dos pés. */
        this.position = { x: 0, y: 0, z: 0 };
        /** @type {number} */
        this.velocityY = 0;
        /** @type {boolean} */
        this.onGround = true;
        /** @type {number} */
        this.yaw = 0;
        /** @type {number} */
        this.pitch = 0;
        /** @type {number} */
        this.ceilingHeight = Infinity;
        /** @type {Set<string>} */
        this.pressed = new Set();
        /** @type {boolean} */
        this.active = false;
        /** @type {THREE.Raycaster} */
        this.raycaster = new THREE.Raycaster();
        /** @type {THREE.Mesh[]} */
        this.interactives = [];
        /** @type {{type: string, id: string}|null} */
        this.target = null;

        /** @type {() => void} Chamado quando o usuário pressiona E sobre um elemento interativo. */
        this.onInteract = () => {};
        /** @type {(locked: boolean) => void} Chamado quando a captura do cursor muda. */
        this.onLockChange = () => {};

        this.handleKeyDown = this.handleKeyDown.bind(this);
        this.handleKeyUp = this.handleKeyUp.bind(this);
        this.handleMouseMove = this.handleMouseMove.bind(this);
        this.handleLockChange = this.handleLockChange.bind(this);
        this.handleBlur = this.handleBlur.bind(this);
        document.addEventListener('pointerlockchange', this.handleLockChange);
    }

    // #endregion

    // #region Propriedades :: radius, eyeHeight, isLocked

    /** @returns {number} Raio do corpo no plano XZ (metade da maior dimensão horizontal). */
    get radius() {
        return Math.max(this.settings.width, this.settings.depth) / 2;
    }

    /** @returns {number} Altura dos olhos acima dos pés. */
    get eyeHeight() {
        return this.settings.height * PHYSICS.EYE_HEIGHT_RATIO;
    }

    /** @returns {boolean} Verdadeiro se o cursor está capturado pelo controlador. */
    get isLocked() {
        return document.pointerLockElement === this.element;
    }

    // #endregion

    // #region Configuração :: configure(), spawn(), setInteractives(), activate(), deactivate(), requestLock()

    /**
     * @param {PlayerSettings} settings Dimensões e velocidades do personagem.
     * @param {number} ceilingHeight Altura máxima da cabeça (pé-direito).
     */
    configure(settings, ceilingHeight) {
        this.settings = { ...settings };
        this.ceilingHeight = ceilingHeight;
        this.camera.fov = settings.fov;
        this.camera.updateProjectionMatrix();
    }

    /**
     * Posiciona o personagem.
     * @param {number} x X dos pés.
     * @param {number} z Z dos pés.
     * @param {number} rotationDegrees Direção do corpo (0° olha para +Z, igual ao boneco).
     */
    spawn(x, z, rotationDegrees) {
        this.position = { x, y: 0, z };
        // A câmera olha para -Z quando yaw = 0; somar 180° alinha o olhar com a frente do boneco
        this.yaw = degToRad(rotationDegrees) + Math.PI;
        this.pitch = 0;
        this.velocityY = 0;
        this.collisionWorld.resolve(this.position, this.radius, 0, this.settings.height, PHYSICS.STEP_HEIGHT);
        this.position.y = this.collisionWorld.getGroundHeight(this.position.x, this.position.z, this.radius, 0, PHYSICS.STEP_HEIGHT);
        this.syncCamera();
    }

    /**
     * @param {THREE.Mesh[]} meshes Malhas que podem ser acionadas com a tecla E.
     */
    setInteractives(meshes) {
        this.interactives = meshes;
    }

    /**
     * Liga a escuta de teclado e mouse.
     */
    activate() {
        if (this.active) {
            return;
        }
        this.active = true;
        window.addEventListener('keydown', this.handleKeyDown);
        window.addEventListener('keyup', this.handleKeyUp);
        window.addEventListener('blur', this.handleBlur);
        document.addEventListener('mousemove', this.handleMouseMove);
    }

    /**
     * Desliga a escuta e libera o cursor.
     */
    deactivate() {
        this.active = false;
        this.pressed.clear();
        window.removeEventListener('keydown', this.handleKeyDown);
        window.removeEventListener('keyup', this.handleKeyUp);
        window.removeEventListener('blur', this.handleBlur);
        document.removeEventListener('mousemove', this.handleMouseMove);
        if (this.isLocked) {
            document.exitPointerLock();
        }
    }

    /**
     * Solicita a captura do cursor. Precisa ser chamada a partir de um clique do usuário.
     */
    requestLock() {
        /** @type {Promise<void>|undefined} */
        const request = /** @type {any} */ (this.element.requestPointerLock());
        // Navegadores mais novos retornam uma Promise que rejeita se o pedido for rápido demais após sair
        if (request !== undefined && typeof request.catch === 'function') {
            request.catch((error) => {
                if (error instanceof DOMException) {
                    this.logger.warning('Captura do cursor recusada pelo navegador', { reason: error.name });
                    return;
                }
                throw error;
            });
        }
    }

    // #endregion

    // #region Atualização :: update(), moveHorizontally(), updateTarget(), syncCamera(), getStatus()

    /**
     * Avança a simulação.
     * @param {number} delta Tempo do quadro em segundos.
     */
    update(delta) {
        if (!this.active) {
            return;
        }
        if (this.isLocked) {
            this.moveHorizontally(delta);
            if (this.pressed.has('Space') && this.onGround) {
                this.velocityY = PHYSICS.JUMP_SPEED;
                this.onGround = false;
            }
        }

        /** @type {number} */
        const ground = this.collisionWorld.getGroundHeight(this.position.x, this.position.z, this.radius, this.position.y, PHYSICS.STEP_HEIGHT);
        this.velocityY -= PHYSICS.GRAVITY * delta;
        this.position.y += this.velocityY * delta;
        if (this.position.y <= ground) {
            this.position.y = ground;
            this.velocityY = 0;
            this.onGround = true;
        } else {
            this.onGround = false;
        }
        if (this.position.y + this.settings.height > this.ceilingHeight) {
            // Personagens mais altos que o pé-direito ficam encostados no teto em vez de atravessá-lo
            this.position.y = Math.max(ground, this.ceilingHeight - this.settings.height);
            this.velocityY = Math.min(0, this.velocityY);
        }
        this.syncCamera();
        this.updateTarget();
    }

    /**
     * Movimento horizontal em sub-passos curtos para não atravessar paredes finas em quadros lentos.
     * @param {number} delta Tempo do quadro.
     */
    moveHorizontally(delta) {
        /** @type {number} */
        let forward = 0;
        /** @type {number} */
        let strafe = 0;
        if (this.pressed.has('KeyW') || this.pressed.has('ArrowUp')) forward += 1;
        if (this.pressed.has('KeyS') || this.pressed.has('ArrowDown')) forward -= 1;
        if (this.pressed.has('KeyD') || this.pressed.has('ArrowRight')) strafe += 1;
        if (this.pressed.has('KeyA') || this.pressed.has('ArrowLeft')) strafe -= 1;
        if (forward === 0 && strafe === 0) {
            return;
        }
        /** @type {number} */
        const length = Math.hypot(forward, strafe);
        /** @type {number} */
        const speed = this.isRunning() ? this.settings.runSpeed : this.settings.walkSpeed;
        /** @type {number} */
        const sin = Math.sin(this.yaw);
        /** @type {number} */
        const cos = Math.cos(this.yaw);
        // Com yaw = 0 a câmera olha para -Z; a direita é +X
        /** @type {number} */
        const dx = ((-sin * forward + cos * strafe) / length) * speed * delta;
        /** @type {number} */
        const dz = ((-cos * forward - sin * strafe) / length) * speed * delta;
        /** @type {number} */
        const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / PHYSICS.MAX_SUBSTEP));
        for (let index = 0; index < steps; index += 1) {
            this.position.x += dx / steps;
            this.position.z += dz / steps;
            this.collisionWorld.resolve(this.position, this.radius, this.position.y, this.settings.height, PHYSICS.STEP_HEIGHT);
        }
    }

    /**
     * Identifica o elemento interativo (porta) no centro da tela.
     */
    updateTarget() {
        this.target = null;
        if (this.interactives.length === 0) {
            return;
        }
        this.raycaster.setFromCamera(new THREE.Vector2(0, 0), this.camera);
        this.raycaster.far = PHYSICS.INTERACTION_DISTANCE;
        /** @type {THREE.Intersection[]} */
        const hits = this.raycaster.intersectObjects(this.interactives, false);
        if (hits.length > 0) {
            this.target = hits[0].object.userData.interactive;
        }
    }

    /**
     * Copia a posição e a orientação do corpo para a câmera.
     */
    syncCamera() {
        this.camera.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
        this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    }

    /**
     * @returns {boolean} Verdadeiro se Shift está pressionado.
     */
    isRunning() {
        return this.pressed.has('ShiftLeft') || this.pressed.has('ShiftRight');
    }

    /**
     * @returns {PlayerStatus} Dados para o HUD.
     */
    getStatus() {
        return {
            x: this.position.x,
            z: this.position.z,
            eyeHeight: this.position.y + this.eyeHeight,
            running: this.isRunning(),
            target: this.target === null ? null : this.target.type
        };
    }

    // #endregion

    // #region Eventos :: handleKeyDown(), handleKeyUp(), handleMouseMove(), handleLockChange(), handleBlur()

    /** @param {KeyboardEvent} event */
    handleKeyDown(event) {
        if (!this.isLocked) {
            return;
        }
        if (MOVEMENT_KEYS.has(event.code)) {
            event.preventDefault();
            this.pressed.add(event.code);
        }
        if (event.code === 'KeyE' && !event.repeat && this.target !== null) {
            this.onInteract();
        }
    }

    /** @param {KeyboardEvent} event */
    handleKeyUp(event) {
        this.pressed.delete(event.code);
    }

    /** @param {MouseEvent} event */
    handleMouseMove(event) {
        if (!this.isLocked) {
            return;
        }
        this.yaw -= event.movementX * PHYSICS.MOUSE_SENSITIVITY;
        /** @type {number} */
        const limit = degToRad(PHYSICS.MAX_PITCH_DEG);
        this.pitch = Math.max(-limit, Math.min(limit, this.pitch - event.movementY * PHYSICS.MOUSE_SENSITIVITY));
    }

    handleLockChange() {
        if (!this.isLocked) {
            // Teclas soltas fora da captura não geram keyup; limpar evita andar sozinho ao voltar
            this.pressed.clear();
        }
        if (this.active) {
            this.onLockChange(this.isLocked);
        }
    }

    handleBlur() {
        this.pressed.clear();
    }

    // #endregion
}

/**
 * Folha da planta: renderiza a vista de cima em alta resolução e compõe uma imagem PNG
 * com cotas, legenda numerada dos objetos, áreas e verificações, pronta para compartilhar ou imprimir.
 */
import { effectiveFootprint, isSolid } from '../core/geometry.js';
import { formatArea, formatDecimal, formatMeters } from '../core/units.js';

/** Família tipográfica da folha (com alternativas caso a fonte web não esteja carregada). */
const SHEET_FONT = '"Barlow", "Segoe UI", Arial, sans-serif';

/** Largura da coluna de legenda (px). */
const LEGEND_WIDTH = 780;

/**
 * @typedef {Object} SheetContext
 * @property {import('../scene/scene.js').SceneManager} sceneManager Cena.
 * @property {import('../scene/controls.js').BuildControls} controls Controles (escala dos rótulos).
 * @property {import('../scene/world.js').WorldBuilder} world Mundo 3D.
 * @property {import('../core/state.js').ProjectState} state Projeto.
 * @property {import('../core/geometry.js').LayoutAnalysis} analysis Análise da arrumação ativa.
 * @property {import('three').Object3D[]} hide Objetos auxiliares que não devem aparecer na folha.
 */

/**
 * Gera a folha da planta.
 * @param {SheetContext} context Dependências.
 * @returns {Promise<string>} Imagem PNG codificada.
 */
export async function createPlanSheet(context) {
    /** @type {{dataUrl: string, width: number, height: number, originX: number, originZ: number, pixelsPerMeter: number}} */
    const plan = renderPlan(context);
    /** @type {HTMLImageElement} */
    const image = await loadImage(plan.dataUrl);
    return compose(context, plan, image);
}

/**
 * Renderiza a vista de cima com corte horizontal, sem gizmos nem sobreposições, e restaura tudo em seguida.
 * @param {SheetContext} context Dependências.
 * @returns {{dataUrl: string, width: number, height: number, originX: number, originZ: number, pixelsPerMeter: number}} Imagem e mapeamento metro → pixel.
 */
function renderPlan(context) {
    const { sceneManager, controls, world, state, hide } = context;
    /** @type {{width: number, length: number, wallThickness: number}} */
    const env = state.environment;
    /** @type {number} */
    const margin = env.wallThickness + 0.9;
    /** @type {number} */
    const halfWidth = env.width / 2 + margin;
    /** @type {number} */
    const halfHeight = env.length / 2 + margin;
    /** @type {number} */
    const pixelsPerMeter = Math.min(240, 1600 / (2 * Math.max(halfWidth, halfHeight)));
    /** @type {number} */
    const width = Math.round(2 * halfWidth * pixelsPerMeter);
    /** @type {number} */
    const height = Math.round(2 * halfHeight * pixelsPerMeter);
    /** @type {import('three').OrthographicCamera} */
    const camera = sceneManager.planCamera;

    /** @type {{position: import('three').Vector3, quaternion: import('three').Quaternion, zoom: number, halfHeight: number, visible: boolean[], section: number|null, mode: 'build'|'explore'}} */
    const saved = {
        position: camera.position.clone(),
        quaternion: camera.quaternion.clone(),
        zoom: camera.zoom,
        halfHeight: sceneManager.planHalfHeight,
        visible: hide.map((item) => item.visible),
        section: world.sectionHeight,
        mode: world.mode
    };
    /** @type {boolean} */
    const castShadow = sceneManager.sun.castShadow;
    try {
        // Sombras do sol confundem a leitura de uma planta
        sceneManager.sun.castShadow = false;
        hide.forEach((item) => {
            item.visible = false;
        });
        // Convenção de planta baixa: corte a 1,50 m, salvo se o usuário escolheu outra altura
        world.sectionHeight = saved.section ?? 1.5;
        world.setMode('build');
        camera.left = -halfWidth;
        camera.right = halfWidth;
        camera.top = halfHeight;
        camera.bottom = -halfHeight;
        camera.zoom = 1;
        camera.position.set(env.width / 2, 100, env.length / 2);
        camera.lookAt(env.width / 2, 0, env.length / 2);
        camera.updateProjectionMatrix();
        sceneManager.planHalfHeight = halfHeight;
        controls.updateLabelScale(true);
        sceneManager.renderer.setSize(width, height, false);
        sceneManager.renderer.render(sceneManager.scene, camera);
        // A leitura precisa acontecer na mesma tarefa da renderização (o buffer não é preservado)
        return {
            dataUrl: sceneManager.renderer.domElement.toDataURL('image/png'),
            width,
            height,
            originX: env.width / 2 - halfWidth,
            originZ: env.length / 2 - halfHeight,
            pixelsPerMeter
        };
    } finally {
        sceneManager.sun.castShadow = castShadow;
        hide.forEach((item, index) => {
            item.visible = saved.visible[index];
        });
        camera.position.copy(saved.position);
        camera.quaternion.copy(saved.quaternion);
        camera.zoom = saved.zoom;
        sceneManager.planHalfHeight = saved.halfHeight;
        world.sectionHeight = saved.section;
        world.setMode(saved.mode);
        sceneManager.resize();
        controls.updateLabelScale();
    }
}

/**
 * @param {string} source Endereço da imagem.
 * @returns {Promise<HTMLImageElement>} Imagem carregada.
 */
function loadImage(source) {
    return new Promise((resolve, reject) => {
        /** @type {HTMLImageElement} */
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error('Falha ao montar a imagem da planta.'));
        image.src = source;
    });
}

/**
 * Quebra um texto em linhas que caibam na largura.
 * @param {CanvasRenderingContext2D} ctx Contexto.
 * @param {string} text Texto.
 * @param {number} maxWidth Largura máxima.
 * @returns {string[]} Linhas.
 */
function wrap(ctx, text, maxWidth) {
    /** @type {string[]} */
    const lines = [];
    /** @type {string} */
    let line = '';
    for (const word of text.split(' ')) {
        /** @type {string} */
        const candidate = line === '' ? word : `${line} ${word}`;
        if (ctx.measureText(candidate).width > maxWidth && line !== '') {
            lines.push(line);
            line = word;
        } else {
            line = candidate;
        }
    }
    if (line !== '') {
        lines.push(line);
    }
    return lines;
}

/**
 * Monta a folha: cabeçalho, planta numerada, escala gráfica e legenda.
 * @param {SheetContext} context Dependências.
 * @param {{width: number, height: number, originX: number, originZ: number, pixelsPerMeter: number}} plan Planta renderizada.
 * @param {HTMLImageElement} image Imagem da planta.
 * @returns {string} PNG codificado.
 */
function compose(context, plan, image) {
    const { state, analysis } = context;
    /** @type {number} */
    const padding = 48;
    /** @type {number} */
    const headerHeight = 150;
    /** @type {any[]} */
    const items = state.objects.filter((item) => isSolid(item) && item.hidden !== true);

    /** @type {Array<{text: string, font: string, color: string, gap: number}>} */
    const legend = [];
    /**
     * @param {string} text Texto.
     * @param {'title'|'body'|'warn'|'muted'} style Estilo.
     */
    const add = (text, style) => {
        /** @type {Record<string, {font: string, color: string, gap: number}>} */
        const styles = {
            title: { font: `600 28px ${SHEET_FONT}`, color: '#1e2930', gap: 18 },
            body: { font: `400 22px ${SHEET_FONT}`, color: '#1e2930', gap: 6 },
            warn: { font: `400 22px ${SHEET_FONT}`, color: '#b3261e', gap: 6 },
            muted: { font: `400 20px ${SHEET_FONT}`, color: '#59666e', gap: 6 }
        };
        legend.push({ text, ...styles[style] });
    };
    /** @type {{width: number, length: number, height: number, wallThickness: number}} */
    const env = state.environment;
    add('Medidas', 'title');
    add(`Área interna: ${formatMeters(env.width)} × ${formatMeters(env.length)} = ${formatArea(env.width * env.length)}`, 'body');
    add(`Pé-direito: ${formatMeters(env.height)}`, 'body');
    add(`Piso livre aproximado: ${formatArea(analysis.freeArea)}`, 'body');
    for (const room of state.rooms) {
        add(`${room.name}: ${formatArea(room.width * room.length)}`, 'body');
    }
    add('Itens (largura × profundidade × altura)', 'title');
    items.forEach((item, index) => add(`${index + 1}. ${item.name}: ${formatDecimal(item.width)} × ${formatDecimal(item.depth)} × ${formatDecimal(item.height)} m${item.isOpen === true ? ' (aberto)' : ''}`, analysis.conflictIds.has(item.id) ? 'warn' : 'body'));
    add('Verificações', 'title');
    if (analysis.issues.length === 0) {
        add('Nenhum conflito, porta bloqueada ou área de uso insuficiente.', 'body');
    }
    for (const issue of analysis.issues.slice(0, 18)) {
        add(issue.message, 'warn');
    }
    if (analysis.issues.length > 18) {
        add(`E mais ${analysis.issues.length - 18} ponto(s) de atenção.`, 'muted');
    }

    /** @type {HTMLCanvasElement} */
    const measure = document.createElement('canvas');
    /** @type {CanvasRenderingContext2D} */
    const measureContext = /** @type {CanvasRenderingContext2D} */ (measure.getContext('2d'));
    /** @type {Array<{lines: string[], font: string, color: string, gap: number, lineHeight: number}>} */
    const blocks = legend.map((entry) => {
        measureContext.font = entry.font;
        return { ...entry, lines: wrap(measureContext, entry.text, LEGEND_WIDTH - 20), lineHeight: Number.parseInt(entry.font.split(' ')[1], 10) * 1.3 };
    });
    /** @type {number} */
    const legendHeight = blocks.reduce((sum, block) => sum + block.gap + block.lines.length * block.lineHeight, 0);

    /** @type {HTMLCanvasElement} */
    const canvas = document.createElement('canvas');
    canvas.width = padding * 3 + plan.width + LEGEND_WIDTH;
    canvas.height = headerHeight + Math.max(plan.height + 90, legendHeight) + padding;
    /** @type {CanvasRenderingContext2D} */
    const ctx = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f5c518';
    ctx.fillRect(0, 0, canvas.width, 14);

    ctx.fillStyle = '#1e2930';
    ctx.font = `700 46px ${SHEET_FONT}`;
    ctx.fillText(state.project.name, padding, 78);
    ctx.font = `400 24px ${SHEET_FONT}`;
    ctx.fillStyle = '#59666e';
    ctx.fillText(`Planta de layout: ${state.getActiveLayout().name}. Gerada em ${new Date().toLocaleDateString('pt-BR')}. Corte horizontal a ${formatMeters(context.world.sectionHeight ?? 1.5)}.`, padding, 118);

    /** @type {number} */
    const planX = padding;
    /** @type {number} */
    const planY = headerHeight;
    ctx.drawImage(image, planX, planY);
    ctx.strokeStyle = '#c7cdc4';
    ctx.lineWidth = 2;
    ctx.strokeRect(planX, planY, plan.width, plan.height);

    items.forEach((item, index) => {
        /** @type {import('../core/geometry.js').OrientedBox} */
        const box = effectiveFootprint(item);
        /** @type {number} */
        const x = planX + (box.cx - plan.originX) * plan.pixelsPerMeter;
        /** @type {number} */
        const y = planY + (box.cz - plan.originZ) * plan.pixelsPerMeter;
        ctx.beginPath();
        ctx.arc(x, y, 17, 0, Math.PI * 2);
        ctx.fillStyle = analysis.conflictIds.has(item.id) ? '#b3261e' : '#1e2930';
        ctx.fill();
        ctx.fillStyle = '#ffffff';
        ctx.font = `600 19px ${SHEET_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(String(index + 1), x, y + 1);
    });
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';

    // Escala gráfica de 1 m
    /** @type {number} */
    const barY = planY + plan.height + 50;
    ctx.fillStyle = '#1e2930';
    ctx.fillRect(planX, barY, plan.pixelsPerMeter, 8);
    ctx.fillRect(planX, barY - 8, 3, 24);
    ctx.fillRect(planX + plan.pixelsPerMeter - 3, barY - 8, 3, 24);
    ctx.font = `400 20px ${SHEET_FONT}`;
    ctx.fillText(`1 m. Grade de ${formatDecimal(state.settings.gridStep)} m. Medidas em metros.`, planX + plan.pixelsPerMeter + 16, barY + 10);

    /** @type {number} */
    const legendX = planX + plan.width + padding;
    /** @type {number} */
    let cursorY = headerHeight - 10;
    for (const block of blocks) {
        cursorY += block.gap;
        ctx.font = block.font;
        ctx.fillStyle = block.color;
        for (const line of block.lines) {
            cursorY += block.lineHeight;
            ctx.fillText(line, legendX, cursorY);
        }
    }
    return canvas.toDataURL('image/png');
}

/**
 * Importação da planta de fundo: imagens (PNG, JPG, WebP) ou uma página de PDF.
 * O PDF é renderizado com pdf.js, carregado sob demanda para não pesar o início da aplicação.
 */
import { PDFJS_BASE_URL, UNDERLAY_MAX_PIXELS } from '../core/config.js';
import { Logger } from '../core/logger.js';

/** @type {Logger} */
const logger = new Logger('plan-import');

/** Erros do pdf.js que significam arquivo ilegível (e não falha de programação). */
const PDF_ERROR_NAMES = new Set(['InvalidPDFException', 'MissingPDFException', 'UnexpectedResponseException', 'PasswordException', 'FormatError']);

/**
 * Falha ao ler o arquivo da planta; a mensagem é exibida ao usuário.
 */
export class PlanImportError extends Error {
    /**
     * @param {string} message Mensagem para o usuário.
     */
    constructor(message) {
        super(message);
        /** @type {string} */
        this.name = 'PlanImportError';
    }
}

/**
 * @typedef {Object} PlanImage
 * @property {string} name Nome exibido.
 * @property {string} dataUrl Imagem JPEG codificada.
 * @property {number} pixelWidth Largura em pixels.
 * @property {number} pixelHeight Altura em pixels.
 */

/**
 * Lê um arquivo de planta.
 * @param {File} file Arquivo escolhido.
 * @param {(pageCount: number) => Promise<number|null>} choosePage Pergunta qual página usar (PDF com várias páginas).
 * @returns {Promise<PlanImage|null>} Imagem pronta ou null se o usuário cancelar.
 * @throws {PlanImportError} Formato não suportado ou arquivo ilegível.
 */
export async function loadPlanFile(file, choosePage) {
    /** @type {boolean} */
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (isPdf) {
        return loadPdfPage(file, choosePage);
    }
    if (!/^image\/(png|jpeg|webp|gif|bmp)$/.test(file.type)) {
        throw new PlanImportError('Use uma imagem (PNG, JPG ou WebP) ou um PDF.');
    }
    /** @type {ImageBitmap} */
    let bitmap;
    try {
        bitmap = await createImageBitmap(file);
    } catch (error) {
        if (error instanceof DOMException) {
            throw new PlanImportError('Não foi possível abrir a imagem. O arquivo pode estar corrompido.');
        }
        throw error;
    }
    /** @type {number} */
    const scale = Math.min(1, UNDERLAY_MAX_PIXELS / Math.max(bitmap.width, bitmap.height));
    /** @type {HTMLCanvasElement} */
    const canvas = createCanvas(bitmap.width * scale, bitmap.height * scale);
    /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d')).drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return encode(canvas, file.name);
}

/**
 * @param {File} file PDF.
 * @param {(pageCount: number) => Promise<number|null>} choosePage Escolha da página.
 * @returns {Promise<PlanImage|null>} Página renderizada.
 * @throws {PlanImportError} PDF ilegível ou pdf.js indisponível.
 */
async function loadPdfPage(file, choosePage) {
    /** @type {any} */
    let pdfjs;
    try {
        pdfjs = await import(/* @vite-ignore */ `${PDFJS_BASE_URL}pdf.min.mjs`);
    } catch (error) {
        if (error instanceof TypeError) {
            throw new PlanImportError('Não foi possível carregar o leitor de PDF. Verifique a conexão ou use uma imagem da planta.');
        }
        throw error;
    }
    pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_BASE_URL}pdf.worker.min.mjs`;
    try {
        /** @type {any} */
        const documentProxy = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        /** @type {number} */
        let pageNumber = 1;
        if (documentProxy.numPages > 1) {
            /** @type {number|null} */
            const chosen = await choosePage(documentProxy.numPages);
            if (chosen === null) {
                return null;
            }
            pageNumber = Math.min(documentProxy.numPages, Math.max(1, Math.round(chosen)));
        }
        /** @type {any} */
        const page = await documentProxy.getPage(pageNumber);
        /** @type {any} */
        const base = page.getViewport({ scale: 1 });
        /** @type {any} */
        const viewport = page.getViewport({ scale: UNDERLAY_MAX_PIXELS / Math.max(base.width, base.height) });
        /** @type {HTMLCanvasElement} */
        const canvas = createCanvas(viewport.width, viewport.height);
        await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
        logger.info('Página de PDF renderizada', { page: pageNumber, width: canvas.width, height: canvas.height });
        return encode(canvas, `${file.name} (página ${pageNumber})`);
    } catch (error) {
        if (error instanceof Error && PDF_ERROR_NAMES.has(error.name)) {
            throw new PlanImportError(error.name === 'PasswordException' ? 'O PDF é protegido por senha.' : 'Não foi possível ler o PDF.');
        }
        throw error;
    }
}

/**
 * Cria um canvas com fundo branco (plantas transparentes ficariam invisíveis sobre o piso).
 * @param {number} width Largura.
 * @param {number} height Altura.
 * @returns {HTMLCanvasElement} Canvas.
 */
function createCanvas(width, height) {
    /** @type {HTMLCanvasElement} */
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width));
    canvas.height = Math.max(1, Math.round(height));
    /** @type {CanvasRenderingContext2D} */
    const context = /** @type {CanvasRenderingContext2D} */ (canvas.getContext('2d'));
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas;
}

/**
 * @param {HTMLCanvasElement} canvas Canvas.
 * @param {string} name Nome.
 * @returns {PlanImage} Imagem codificada.
 */
function encode(canvas, name) {
    return { name, dataUrl: canvas.toDataURL('image/jpeg', 0.9), pixelWidth: canvas.width, pixelHeight: canvas.height };
}

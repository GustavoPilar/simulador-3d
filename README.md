# Simulador 3D de Ambientes

Aplicação web 100% frontend para construir um ambiente em escala real (1 unidade = 1 metro) e caminhar dentro dele em primeira pessoa.

## Como executar

Módulos ES não carregam via `file://`, então sirva a pasta com qualquer servidor estático (não há backend):

```bash
python3 -m http.server 8080
# ou: npx serve .
```

Abra `http://localhost:8080`. O Three.js r170 (MIT) é carregado do jsDelivr pelo `importmap` do `index.html`; é preciso internet na primeira carga.

## Novidades da versão 3

- **Ver de cima sem remover o teto.** Duas formas, ambas só no modo construção (o modo explorar mostra tudo como é):
  - **Corte horizontal** (botão "Corte" ou tecla `C`): esconde tudo acima da altura escolhida (1,50 m por padrão), como uma planta baixa. Paredes e móveis cortados ganham preenchimento; janelas aparecem em azul.
  - **Por elemento:** "Opacidade ao construir" (5 a 100%) e "Ocultar ao construir" (tecla `H`) em qualquer objeto ou parede, inclusive as externas. Elementos ocultos continuam na lista "Elementos" para serem selecionados.
- **Detecção de sobreposição.** Móveis que invadem outro móvel ou atravessam uma parede ficam contornados em vermelho e aparecem nas verificações, inclusive durante o arrasto. Cadeira sob a mesa e objetos apoiados sobre outros não contam como conflito; forros também ficam de fora.
- **Móveis com partes móveis.** Sofá (retrátil, com "Profundidade aberto"), armário e geladeira têm estado Fechado/Aberto, no painel ou com a tecla `E` no modo explorar. Aberto, o sofá ocupa mais piso e as portas do armário e da geladeira bloqueiam a passagem.
- **Áreas de uso por tipo de móvel.** Cada objeto tem área de uso à frente, atrás e lateral (editáveis), com padrões como 80 cm à frente de pia, fogão e geladeira, 60 cm atrás de cadeira e 50 cm em pelo menos uma lateral da cama. Elas aparecem no piso em verde (atendida) ou vermelho, para o objeto selecionado ou para todos ("Mostrar áreas de uso").
- **Arrumações.** Várias disposições de móveis no mesmo projeto ("Nova cópia", "Renomear", "Excluir"). Paredes, portas e janelas são compartilhadas. "Comparar" mostra piso livre, conflitos, portas bloqueadas e áreas de uso de cada arrumação.
- **Minha biblioteca.** "Salvar na minha biblioteca" guarda as medidas reais de um objeto no navegador para reutilizar em outros projetos; a biblioteca pode ser exportada e importada em JSON.
- **Folha da planta (PNG).** Vista de cima com corte a 1,50 m, cotas, objetos numerados, legenda com medidas, áreas e verificações e escala gráfica, pronta para compartilhar ou imprimir.

Ficaram para uma próxima versão, por não poderem ser testados de forma confiável aqui ou exigirem uma reestruturação maior: realidade virtual (WebXR), ambientes não retangulares e materiais com luz natural.

## Novidades da versão 2

- **Planta de fundo calibrada.** Importe uma imagem (PNG, JPG, WebP) ou uma página de PDF. Clique nas duas pontas de uma cota conhecida e informe a medida real ("Calibrar escala"). Depois clique no canto interno que deve ficar na origem ("Alinhar canto"). A imagem fica no piso em escala 1:1 e você desenha por cima. Opacidade, rotação e posição são ajustáveis em "Ajustar planta". O PDF é lido com pdf.js (Apache-2.0), carregado só quando necessário.
- **Vista Planta (2D).** Vista ortográfica de cima, orientada exatamente como uma imagem: X para a direita, Z para baixo. Atalho `V`.
- **Encaixe em paredes.** Ao desenhar paredes e usar a trena, o cursor gruda em cantos (marcador verde) e faces de paredes (azul) antes da grade.
- **Trena** (`M`): mede entre dois pontos; as medidas ficam na tela até "Limpar medidas da trena".
- **Folgas ao vivo.** Com um objeto selecionado, linhas laranja mostram a distância até o obstáculo mais próximo nos quatro lados (inclusive durante o arrasto). "Encostar atrás" leva o objeto até a parede.
- **Portas e janelas pelas folgas.** "Folga até o início" e "Folga até o fim" são editáveis e medidas a partir da face interna dos cantos, como nas cotas de planta. O arco de abertura das portas aparece no piso.
- **Espelhar e girar o projeto** (↔, ↕ e 180°), para plantas tipo espelhadas entre unidades.
- **Desfazer e refazer** (`Ctrl+Z`, `Ctrl+Shift+Z` ou `Ctrl+Y`), até 100 passos. A planta de fundo não entra no histórico.
- **Áreas:** interna, com paredes externas (próxima da área privativa de contratos) e soma dos cômodos.
- **Elementos técnicos:** pilar/shaft (piso a teto), rebaixo de teto, ponto de luz, tomada, interruptor e ponto de água. Os pontos de instalação não bloqueiam a passagem.
- **Verificações:** portas cuja folha bate em móveis e passagens com menos de 60 cm à frente de móveis aparecem no painel do ambiente.

## Orientação (importante)

Na vista Planta, a imagem aparece exatamente como no papel: X cresce para a direita e Z cresce **para baixo**. A origem (0, 0) é o canto interno **superior esquerdo**. As paredes externas se chamam superior (Z = 0), inferior, esquerda (X = 0) e direita. Os identificadores internos `perimeter-south/north/west/east` foram mantidos para compatibilidade com arquivos da versão 1 (south = superior, north = inferior, west = esquerda, east = direita).

O arquivo `examples/studio-1610.json` é a Planta Tipo A (final 10) do Residencial New Garden nessa convenção (pé-direito de 2,60 m, conforme o memorial do contrato). `examples/studio-1610-mobiliado.json` traz o mesmo studio mobiliado.

## Fluxo

1. Informe nome, largura, comprimento e pé-direito (vírgula ou ponto).
2. Opcional: importe a planta, calibre e alinhe.
3. No modo **Construir**: desenhe paredes clicando no piso (de preferência na vista Planta), crie cômodos, portas, janelas e objetos; ajuste tudo no painel da direita ou arrastando o gizmo.
4. Em **Personagem e escala**, configure altura, largura, profundidade, velocidades e campo de visão.
5. Clique em **Explorar** e em **Entrar no ambiente**.

## Controles

| Modo | Ação |
|---|---|
| Construir (3D) | Arrastar: girar vista; botão direito: deslocar; roda: zoom |
| Construir (Planta) | Arrastar: deslocar; roda: zoom |
| Construir | `V` 3D/Planta, `C` corte horizontal, `H` ocultar o selecionado, `M` trena, `G` mover, `R` girar, `Ctrl+D` duplicar, `Del` excluir, `Ctrl+Z` desfazer, `Esc` cancelar/desselecionar |
| Explorar | `W A S D` andar · mouse olhar · `Shift` correr · `Espaço` pular · `E` abrir/fechar porta, sofá retrátil, armário ou geladeira |
| Explorar | `Esc` pausa; `Esc` de novo volta a construir |

## Convenções

- Origem (0, 0, 0) no canto interno superior esquerdo da vista Planta, sobre o piso.
- X = largura (para a direita), Z = comprimento (para baixo na Planta), Y = altura. Valores internos em metros com ponto; exibição com vírgula e duas casas.
- As paredes externas ficam **fora** da área interna: 5 × 8 m são 5 × 8 m úteis.
- Portas e janelas pertencem a uma parede; "Posição na parede" é a distância do início da parede até o centro da abertura.
- O corpo do personagem é um cilindro com raio = metade da maior dimensão horizontal; os olhos ficam a 93% da altura.

## Estrutura

```
index.html
css/style.css
js/main.js                 Orquestração (fluxo, modos, seleção, ações)
js/core/                   Lógica sem Three.js (testável no Node)
  config.js                Constantes, limites, catálogo de objetos
  schema.js                Esquemas de campos: validação + formulários
  state.js                 Estado do projeto e regras entre entidades
  collision.js             Colisão círculo × caixa orientada
  storage.js               Exportar/importar JSON e salvamento automático
  geometry.js              Caixas orientadas, raios, folgas, encaixe e verificações (v2)
  history.js               Desfazer/refazer por instantâneos (v2)
  library.js               Biblioteca pessoal de objetos (v3)
  units.js, logger.js      Formatação, utilitários, logs e exceções
js/scene/                  Renderização
  scene.js                 Renderizador, câmeras, luzes, loop
  world.js                 Estado → cena 3D e colisores
  environment.js           Piso, teto, grade, cotas
  walls.js                 Paredes com recortes de portas/janelas
  objects.js               Móveis e boneco de escala
  controls.js              Vistas 3D/Planta, gizmo, seleção, encaixe, ferramentas de clique
  overlays.js              Folgas, áreas de uso e conflitos desenhados na cena
  player.js                Controlador em primeira pessoa
  labels.js, materials.js  Rótulos e materiais compartilhados
js/ui/editor.js            Painel de propriedades, lista, avisos, diálogo numérico
js/ui/plan-import.js       Leitura de imagem/PDF da planta (v2)
js/ui/plan-sheet.js        Folha da planta em PNG (v3)
examples/studio-1610.json  Exemplo real na convenção v2
tests/                     Testes unitários (node:test)
```

## Testes

```bash
node --test "tests/**/*.test.js"
node --test --experimental-test-coverage "tests/**/*.test.js"
```

Cobrem estado, validação, importação/exportação e colisão (Node 20+, sem dependências).

## Persistência

Sem banco de dados: **Exportar** baixa `nome-do-projeto.json` (inclui a planta de fundo); **Importar** reconstrói o projeto validando cada item e aceita arquivos da versão 1. O último projeto também é salvo no `localStorage` e pode ser retomado pela tela inicial; se a planta for grande demais para a cota do navegador, ela é omitida do salvamento automático e o programa avisa.

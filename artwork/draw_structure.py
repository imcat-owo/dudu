#!/usr/bin/env python3
"""Nesting-structure diagrams, one node per row, indented outline style. No overlaps possible."""
from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc"
BG = (250, 250, 249)
INK = (35, 35, 35)
MUTED = (130, 130, 130)
BOX_FILL = (255, 255, 255)
BOX_EDGE = (205, 205, 205)
ACCENT_EDGE = (110, 110, 110)
LINE = (170, 170, 170)
INDENT_X = 56
ROW_H = 78
MARGIN = 60
TOP = 150
PAD_X, PAD_Y = 20, 13

def font(size):
    return ImageFont.truetype(FONT, size, index=0)

def text_size(s, f):
    b = f.getbbox(s)
    return b[2] - b[0], b[3] - b[1]

class Node:
    def __init__(self, label, children=None, note=False, accent=False):
        self.label = label
        self.children = children or []
        self.note = note
        self.accent = accent

def draw_tree(path, title, subtitle, root):
    f_title, f_node, f_note, f_small = font(36), font(25), font(22), font(20)
    order = []
    def walk(n, depth):
        n.depth = depth
        ff = f_note if n.note else f_node
        tw, th = text_size(n.label, ff)
        n.w, n.h = tw + PAD_X * 2, th + PAD_Y * 2
        n.lx = MARGIN + depth * INDENT_X  # left edge
        n.row = len(order)
        order.append(n)
        for c in n.children:
            walk(c, depth + 1)
    walk(root, 0)
    for n in order:
        n.cy = TOP + n.row * ROW_H + ROW_H / 2
    max_right = max(n.lx + n.w for n in order)
    W = int(max_right + MARGIN + 30)
    H = int(TOP + len(order) * ROW_H + 100)
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    d.text((MARGIN, 34), title, font=f_title, fill=INK)
    d.text((MARGIN, 86), subtitle, font=f_small, fill=MUTED)
    # elbow connectors: vertical guide at parent's column, then into child
    def edges(n):
        col = n.lx + 14
        for c in n.children:
            y1 = n.cy + n.h / 2
            y2 = c.cy
            x2 = c.lx + 14
            d.line([(col, y1), (col, y2)], fill=LINE, width=2)
            d.line([(col, y2), (x2, y2)], fill=LINE, width=2)
            d.ellipse([x2 - 4, y2 - 4, x2 + 4, y2 + 4], fill=LINE)
            edges(c)
    edges(root)
    for n in order:
        edge = ACCENT_EDGE if n.accent else BOX_EDGE
        fill = (243, 243, 242) if n.note else BOX_FILL
        ff = f_note if n.note else f_node
        x0 = n.lx + 28
        y0 = n.cy - n.h / 2
        d.rounded_rectangle([x0, y0, x0 + n.w, y0 + n.h], radius=11,
                            fill=fill, outline=edge, width=2 if n.accent else 1)
        tw, th = text_size(n.label, ff)
        d.text((x0 + PAD_X, n.cy - th / 2), n.label, font=ff,
               fill=MUTED if n.note else INK)
    d.text((MARGIN, H - 54), "整理自对 Claude App 真实截图的逐条比对记录（2026-09~10）", font=f_small, fill=MUTED)
    img.save(path)
    print("saved", path, img.size)

t1 = Node("Assistant Turn（助手的一轮消息）", accent=True, children=[
    Node("Thinking 指示器（active）", children=[
        Node("星号标记：旋转 / 呼吸动效"),
        Node("微光标签：Thinking…（扫光）"),
        Node("注：settled 后静止，扫光停止", note=True),
    ]),
    Node("Thinking 内容块（可折叠）", children=[
        Node("思考文本"),
        Node("左侧一条细、低对比竖线", children=[
            Node("注：仅 reasoning 消息有；工具之间的 notes 没有", note=True),
        ]),
    ]),
])
draw_tree("/home/hatch/workspace/openmuse/artwork/claude-thinking-structure.png",
          "Claude Thinking 嵌套结构",
          "实拍：指示器 → 内容块，竖线只出现在 reasoning 文本左侧",
          t1)

t2 = Node("Assistant Turn（助手的一轮消息）", accent=True, children=[
    Node("Tool Run 行（内联一行）", children=[
        Node("过去式句子标签（如 Ran 3 commands）"),
        Node("绿/红行数 pill（如 +292 −0）"),
        Node("› 箭头"),
        Node("点击 → Run Sheet（底部弹窗）", accent=True, children=[
            Node("默认半高，可拖到全屏，可滚动"),
            Node("标题居中，状态居中其下，左上 X 关闭"),
            Node("调用列表：每行 = 图标 + 动词 + 描述"),
            Node("点击某行 → Call Sheet", children=[
                Node("标题 / 状态（Completed）"),
                Node("输入：按名称逐项列出"),
                Node("输出：JSON 带 Prettify 开关"),
            ]),
        ]),
    ]),
    Node("运行中行：◇ Running agent ›（双菱形图标 + 微光标签）"),
    Node("后台任务：composer 上方 Cooking… · N running tasks", children=[
        Node("点击 → Background tasks Sheet（Running / Finished N）", note=True),
    ]),
])
draw_tree("/home/hatch/workspace/openmuse/artwork/claude-toolcall-structure.png",
          "Claude 工具调用嵌套结构",
          "实拍：行 → 底部 Sheet → 每调用独立 Sheet，工具调用不在行内展开",
          t2)

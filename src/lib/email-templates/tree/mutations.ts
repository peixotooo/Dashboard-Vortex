// src/lib/email-templates/tree/mutations.ts
//
// Pure helpers for mutating a SectionNode[] tree. Used by the editor's
// structure panel (drag-reorder, add, remove, duplicate) and the inspector
// (cross-leaf product propagation, single-leaf updates).

import type {
  SectionNode,
  RowNode,
  ColumnNode,
  LeafNode,
  AnyNode,
} from "./schema";
import { newId } from "./schema";
import type { ProductSnapshot } from "../types";

// ---------- Find / update / remove a leaf by id ----------

export function findLeaf(sections: SectionNode[], id: string): LeafNode | null {
  for (const s of sections) {
    for (const child of s.children) {
      if (child.type === "row") {
        for (const col of child.columns) {
          for (const leaf of col.children) if (leaf.id === id) return leaf;
        }
      } else {
        if (child.id === id) return child;
      }
    }
  }
  return null;
}

export function updateLeaf(
  sections: SectionNode[],
  id: string,
  patch: Partial<LeafNode>
): SectionNode[] {
  return sections.map((s) => ({
    ...s,
    children: s.children.map((child) => {
      if (child.type === "row") {
        return {
          ...child,
          columns: child.columns.map((col) => ({
            ...col,
            children: col.children.map((leaf) =>
              leaf.id === id ? ({ ...leaf, ...patch } as LeafNode) : leaf
            ),
          })),
        };
      }
      return child.id === id ? ({ ...child, ...patch } as LeafNode) : child;
    }),
  }));
}

export function removeLeaf(sections: SectionNode[], id: string): SectionNode[] {
  return sections
    .map((s) => ({
      ...s,
      children: s.children
        .map((child) => {
          if (child.type === "row") {
            const cols = child.columns.map((col) => ({
              ...col,
              children: col.children.filter((leaf) => leaf.id !== id),
            }));
            // keep the row even if some columns empty (preserves layout)
            return { ...child, columns: cols };
          }
          return child.id === id ? null : child;
        })
        .filter(Boolean) as Array<LeafNode | RowNode>,
    }))
    .filter((s) => s.children.length > 0);
}

export function duplicateLeaf(sections: SectionNode[], id: string): SectionNode[] {
  return sections.map((s) => {
    const newChildren: Array<LeafNode | RowNode> = [];
    for (const child of s.children) {
      if (child.type === "row") {
        newChildren.push({
          ...child,
          columns: child.columns.map((col) => {
            const cleafs: LeafNode[] = [];
            for (const leaf of col.children) {
              cleafs.push(leaf);
              if (leaf.id === id) cleafs.push({ ...leaf, id: newId() } as LeafNode);
            }
            return { ...col, children: cleafs };
          }),
        });
      } else {
        newChildren.push(child);
        if (child.id === id) newChildren.push({ ...child, id: newId() } as LeafNode);
      }
    }
    return { ...s, children: newChildren };
  });
}

// ---------- Append a leaf at the document tail (default for palette inserts) ----------

export function appendLeafToLastSection(
  sections: SectionNode[],
  leaf: LeafNode
): SectionNode[] {
  if (sections.length === 0) {
    return [
      {
        id: newId(),
        type: "section",
        padding: "32px 32px",
        children: [leaf],
      },
    ];
  }
  const last = sections[sections.length - 1];
  return [
    ...sections.slice(0, -1),
    { ...last, children: [...last.children, leaf] },
  ];
}

// ---------- Flatten for the structure panel ----------

export interface FlatLeaf {
  leaf: LeafNode;
  /** "section:<id>" if leaf is a direct child of a section, "column:<id>" if
   *  it's inside a row's column. Drag-reorder is allowed only within the
   *  same parentKey. */
  parentKey: string;
  /** Human-readable breadcrumb. */
  breadcrumb: string;
}

export function flattenLeaves(sections: SectionNode[]): FlatLeaf[] {
  const out: FlatLeaf[] = [];
  sections.forEach((s, sIdx) => {
    s.children.forEach((child) => {
      if (child.type === "row") {
        child.columns.forEach((col, cIdx) => {
          col.children.forEach((leaf) => {
            out.push({
              leaf,
              parentKey: `column:${col.id}`,
              breadcrumb: `Seção ${sIdx + 1} · Coluna ${cIdx + 1}`,
            });
          });
        });
      } else {
        out.push({
          leaf: child,
          parentKey: `section:${s.id}`,
          breadcrumb: `Seção ${sIdx + 1}`,
        });
      }
    });
  });
  return out;
}

// ---------- Reorder (drag-end) ----------

export function reorderLeaves(
  sections: SectionNode[],
  activeId: string,
  overId: string
): SectionNode[] {
  // Identify both leaves' parents. Only proceed if they share a parent.
  const flat = flattenLeaves(sections);
  const a = flat.find((f) => f.leaf.id === activeId);
  const b = flat.find((f) => f.leaf.id === overId);
  if (!a || !b) return sections;
  if (a.parentKey !== b.parentKey) return sections;

  // Mutate the tree at the matching parent.
  if (a.parentKey.startsWith("section:")) {
    const sectionId = a.parentKey.split(":")[1];
    return sections.map((s) => {
      if (s.id !== sectionId) return s;
      return { ...s, children: moveByLeafId(s.children, activeId, overId) as typeof s.children };
    });
  }
  if (a.parentKey.startsWith("column:")) {
    const columnId = a.parentKey.split(":")[1];
    return sections.map((s) => ({
      ...s,
      children: s.children.map((child) => {
        if (child.type !== "row") return child;
        return {
          ...child,
          columns: child.columns.map((col) => {
            if (col.id !== columnId) return col;
            return {
              ...col,
              children: moveByLeafId(col.children, activeId, overId) as LeafNode[],
            };
          }),
        };
      }),
    }));
  }
  return sections;
}

function moveByLeafId<T extends { id: string; type?: string }>(
  arr: T[],
  activeId: string,
  overId: string
): T[] {
  const activeIdx = arr.findIndex(
    (x) => x.id === activeId && x.type !== "row"
  );
  const overIdx = arr.findIndex(
    (x) => x.id === overId && x.type !== "row"
  );
  if (activeIdx === -1 || overIdx === -1) return arr;
  const out = [...arr];
  const [item] = out.splice(activeIdx, 1);
  out.splice(overIdx, 0, item);
  return out;
}

// ---------- Cross-leaf product propagation ----------

/**
 * When the user picks a product on any product-aware leaf (image,
 * product-meta, product-card, product-grid), update every product-aware leaf
 * in the tree so the email stays coherent (image + name + price + CTA all
 * point at the same product).
 *
 * product-grid is intentionally left untouched — it's a curated multi-slot
 * surface, not a single-product reflection.
 */
export function applyProductToTree(
  sections: SectionNode[],
  product: ProductSnapshot
): SectionNode[] {
  const patchLeaf = (leaf: LeafNode): LeafNode => {
    switch (leaf.type) {
      case "image":
        return { ...leaf, src: product.image_url, alt: product.name };
      case "product-meta":
        return {
          ...leaf,
          name: product.name,
          price: product.price,
          old_price: product.old_price,
        };
      case "product-card":
        return { ...leaf, product };
      case "button":
        if (
          !leaf.href ||
          /^https?:\/\/(www\.)?bulking\.com\.br\/?$/i.test(leaf.href) ||
          /\/produto\//i.test(leaf.href)
        ) {
          return { ...leaf, href: product.url || leaf.href };
        }
        return leaf;
      case "coupon":
        return { ...leaf, product_name: product.name };
      default:
        return leaf;
    }
  };
  return sections.map((s) => ({
    ...s,
    children: s.children.map((child) => {
      if (child.type === "row") {
        return {
          ...child,
          columns: child.columns.map((col) => ({
            ...col,
            children: col.children.map(patchLeaf),
          })),
        };
      }
      return patchLeaf(child);
    }),
  }));
}

// re-export AnyNode for downstream typing
export type { AnyNode };

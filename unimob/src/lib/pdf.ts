// Génération de documents PDF côté navigateur (aucun envoi du contenu à un service tiers).
// Les fichiers sont téléchargés localement ; seules les métadonnées sont enregistrées
// dans la table documents (type, référence, date, auteur).
import type { jsPDF } from 'jspdf';
import { insertRow } from '@/api/crud';
import { formatDateTime } from './format';

export type PdfAgency = { agency_name: string; phone?: string | null; email?: string | null; address?: string | null; document_footer?: string | null };

export type PdfBuilder = {
  doc: jsPDF;
  heading: (text: string) => void;
  paragraph: (text: string) => void;
  keyValues: (pairs: Array<[string, string]>) => void;
  table: (head: string[], body: Array<Array<string>>) => void;
  y: () => number;
};

const MARGIN = 16;

export async function buildPdf(agency: PdfAgency, title: string, reference: string, confidential: boolean): Promise<PdfBuilder> {
  const [{ jsPDF }, { default: autoTable }] = await Promise.all([import('jspdf'), import('jspdf-autotable')]);
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const width = doc.internal.pageSize.getWidth();
  let y = MARGIN;

  // En-tête
  doc.setFillColor(31, 31, 34);
  doc.rect(0, 0, width, 26, 'F');
  doc.setTextColor(220, 199, 156);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(14);
  doc.text(agency.agency_name, MARGIN, 11);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(236, 236, 239);
  doc.text([agency.phone, agency.email, agency.address].filter(Boolean).join('  ·  ') || ' ', MARGIN, 18);
  y = 36;
  doc.setTextColor(31, 31, 34);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.text(title, MARGIN, y);
  y += 6;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(107, 107, 115);
  doc.text(`Référence : ${reference}   ·   Généré le ${formatDateTime(new Date())} (heure d’Abidjan)`, MARGIN, y);
  y += 4;
  if (confidential) {
    doc.setTextColor(153, 27, 27);
    doc.text('CONFIDENTIEL — contient des données personnelles ou financières. Ne pas diffuser.', MARGIN, y + 4);
    y += 6;
  }
  y += 6;
  doc.setTextColor(31, 31, 34);

  const ensure = (h: number) => {
    if (y + h > doc.internal.pageSize.getHeight() - 20) {
      doc.addPage();
      y = MARGIN;
    }
  };

  const builder: PdfBuilder = {
    doc,
    heading(text) {
      ensure(12);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(11.5);
      doc.setTextColor(124, 98, 52);
      doc.text(text, MARGIN, y);
      doc.setDrawColor(220, 199, 156);
      doc.line(MARGIN, y + 1.5, width - MARGIN, y + 1.5);
      y += 7;
      doc.setTextColor(31, 31, 34);
    },
    paragraph(text) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(9.5);
      const lines = doc.splitTextToSize(text || '—', width - MARGIN * 2) as string[];
      for (const line of lines) {
        ensure(5);
        doc.text(line, MARGIN, y);
        y += 4.6;
      }
      y += 2;
    },
    keyValues(pairs) {
      autoTable(doc, {
        startY: y,
        body: pairs,
        theme: 'plain',
        margin: { left: MARGIN, right: MARGIN },
        styles: { fontSize: 9, cellPadding: 1.4 },
        columnStyles: { 0: { fontStyle: 'bold', cellWidth: 55, textColor: [58, 58, 64] } },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 5;
    },
    table(head, body) {
      autoTable(doc, {
        startY: y,
        head: [head],
        body: body.length ? body : [[...head.map((_, i) => (i === 0 ? 'Aucun élément' : ''))]],
        margin: { left: MARGIN, right: MARGIN },
        styles: { fontSize: 8.5, cellPadding: 1.6 },
        headStyles: { fillColor: [43, 43, 48], textColor: [236, 236, 239] },
        alternateRowStyles: { fillColor: [250, 248, 244] },
      });
      y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;
    },
    y: () => y,
  };
  return builder;
}

function addFooters(doc: jsPDF, footer: string) {
  const pages = doc.getNumberOfPages();
  const w = doc.internal.pageSize.getWidth();
  const h = doc.internal.pageSize.getHeight();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    doc.setFontSize(7.5);
    doc.setTextColor(107, 107, 115);
    doc.text(footer, MARGIN, h - 8);
    doc.text(`Page ${i} / ${pages}`, w - MARGIN, h - 8, { align: 'right' });
  }
}

/** Enregistre les métadonnées puis déclenche le téléchargement. */
export async function finishPdf(
  b: PdfBuilder,
  agency: PdfAgency,
  meta: { docType: string; title: string; filename: string; entityType?: string; entityId?: string; personal: boolean; template?: boolean },
) {
  let reference = '';
  try {
    const row = await insertRow('documents', {
      doc_type: meta.docType,
      title: meta.title,
      entity_type: meta.entityType ?? null,
      entity_id: meta.entityId ?? null,
      contains_personal_data: meta.personal,
      is_template_validated: false,
    });
    reference = row.reference;
  } catch {
    /* le document reste téléchargeable même si l'enregistrement échoue */
  }
  const disclaimer = meta.template
    ? 'Modèle non validé juridiquement — à faire relire par un professionnel compétent avant toute utilisation.'
    : '';
  addFooters(b.doc, [agency.document_footer, reference && `Doc. ${reference}`, disclaimer].filter(Boolean).join('  ·  ') || agency.agency_name);
  b.doc.save(meta.filename);
  return reference;
}

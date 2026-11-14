import os
from typing import List, Dict, Any
from docx import Document
from docx.shared import Inches, Pt, RGBColor
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn


def set_cell_background(cell, fill_hex: str):
    """Sets background color of a table cell in hex without hash, e.g. 'F0F4F8'."""
    tcPr = cell._tc.get_or_add_tcPr()
    shd = OxmlElement('w:shd')
    shd.set(qn('w:val'), 'clear')
    shd.set(qn('w:color'), 'auto')
    shd.set(qn('w:fill'), fill_hex)
    tcPr.append(shd)


def build_redlined_docx(contract_title: str, redlines: List[Dict[str, Any]], output_path: str) -> str:
    """
    Builds a professional, styled Word (.docx) document containing original contract clauses,
    applied redline changes with tracked additions/deletions, risk levels, and justifications.
    """
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)

    doc = Document()

    # Document Styles & Margins
    sections = doc.sections
    for section in sections:
        section.top_margin = Inches(1.0)
        section.bottom_margin = Inches(1.0)
        section.left_margin = Inches(1.0)
        section.right_margin = Inches(1.0)

    # Title
    title_p = doc.add_paragraph()
    title_p.paragraph_format.space_before = Pt(0)
    title_p.paragraph_format.space_after = Pt(4)
    run_title = title_p.add_run("ClauseGuard AI Redline Report")
    run_title.font.name = "Arial"
    run_title.font.size = Pt(22)
    run_title.font.bold = True
    run_title.font.color.rgb = RGBColor(15, 23, 42)  # Slate 900

    # Subtitle / Contract Title
    sub_p = doc.add_paragraph()
    sub_p.paragraph_format.space_after = Pt(16)
    run_sub = sub_p.add_run(f"Contract: {contract_title}")
    run_sub.font.name = "Arial"
    run_sub.font.size = Pt(13)
    run_sub.font.color.rgb = RGBColor(71, 85, 105)  # Slate 600

    # Summary table
    table = doc.add_table(rows=1, cols=4)
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False

    hdr_cells = table.rows[0].cells
    headers = ["Clause ID", "Section Title", "Risk Level", "Human Decision"]
    for i, h in enumerate(headers):
        hdr_cells[i].text = h
        hdr_run = hdr_cells[i].paragraphs[0].runs[0]
        hdr_run.font.bold = True
        hdr_run.font.size = Pt(10)
        hdr_run.font.color.rgb = RGBColor(255, 255, 255)
        set_cell_background(hdr_cells[i], "1E293B")  # Slate 800

    for r in redlines:
        row_cells = table.add_row().cells
        c_id = r.get("clause_id", "N/A")
        c_title = r.get("clause_title", "Untitled")
        risk = r.get("risk_assessment", "MEDIUM")
        decision = r.get("decision", "APPROVED")

        row_cells[0].text = c_id
        row_cells[1].text = c_title
        row_cells[2].text = risk
        row_cells[3].text = decision

        for idx, cell in enumerate(row_cells):
            set_cell_background(cell, "F8FAFC" if idx % 2 == 0 else "FFFFFF")
            p = cell.paragraphs[0]
            if p.runs:
                p.runs[0].font.size = Pt(9.5)
                p.runs[0].font.color.rgb = RGBColor(51, 65, 85)

    doc.add_paragraph().paragraph_format.space_after = Pt(14)

    # Section divider
    divider = doc.add_paragraph()
    divider.paragraph_format.space_after = Pt(12)
    div_run = divider.add_run("DETAILED CLAUSE REDLINE PROPOSALS")
    div_run.font.name = "Arial"
    div_run.font.size = Pt(14)
    div_run.font.bold = True
    div_run.font.color.rgb = RGBColor(30, 41, 59)

    # Detailed sections for each redline
    for r in redlines:
        clause_id = r.get("clause_id", "C")
        clause_title = r.get("clause_title", "Section")
        risk = r.get("risk_assessment", "HIGH")
        decision = r.get("decision", "APPROVED")
        original = r.get("original_text", "").strip()
        proposed = r.get("proposed_redline", "").strip()
        violation = r.get("policy_violation", "").strip()
        justification = r.get("justification", "").strip()

        # Heading
        head_p = doc.add_paragraph()
        head_p.paragraph_format.space_before = Pt(12)
        head_p.paragraph_format.space_after = Pt(4)
        run_h = head_p.add_run(f"[{clause_id}] {clause_title}")
        run_h.font.name = "Arial"
        run_h.font.size = Pt(12)
        run_h.font.bold = True
        run_h.font.color.rgb = RGBColor(15, 23, 42)

        meta_p = doc.add_paragraph()
        meta_p.paragraph_format.space_after = Pt(6)
        r_risk = meta_p.add_run(f"Risk: {risk} | Decision: {decision.upper()}")
        r_risk.font.size = Pt(9.5)
        r_risk.font.bold = True
        r_risk.font.color.rgb = RGBColor(185, 28, 28) if risk == "HIGH" else RGBColor(161, 98, 7)

        # Policy Violation
        if violation:
            v_p = doc.add_paragraph()
            v_p.paragraph_format.space_after = Pt(4)
            v_label = v_p.add_run("Policy Violation: ")
            v_label.font.bold = True
            v_label.font.size = Pt(9.5)
            v_text = v_p.add_run(violation)
            v_text.font.size = Pt(9.5)
            v_text.font.color.rgb = RGBColor(100, 116, 139)

        # Original Text (strikethrough / red)
        orig_box = doc.add_paragraph()
        orig_box.paragraph_format.space_after = Pt(4)
        lbl_orig = orig_box.add_run("Original Language: \n")
        lbl_orig.font.bold = True
        lbl_orig.font.size = Pt(9.5)
        lbl_orig.font.color.rgb = RGBColor(153, 27, 27)

        run_orig = orig_box.add_run(f'"{original}"')
        run_orig.font.strike = True
        run_orig.font.size = Pt(9.5)
        run_orig.font.color.rgb = RGBColor(185, 28, 28)

        # Proposed / Redlined Text (bold green)
        prop_box = doc.add_paragraph()
        prop_box.paragraph_format.space_after = Pt(4)
        lbl_prop = prop_box.add_run("Compliant Redline Proposal: \n")
        lbl_prop.font.bold = True
        lbl_prop.font.size = Pt(9.5)
        lbl_prop.font.color.rgb = RGBColor(21, 128, 61)

        run_prop = prop_box.add_run(f'"{proposed}"')
        run_prop.font.bold = True
        run_prop.font.size = Pt(9.5)
        run_prop.font.color.rgb = RGBColor(22, 101, 52)

        # Justification
        if justification:
            j_p = doc.add_paragraph()
            j_p.paragraph_format.space_after = Pt(12)
            lbl_j = j_p.add_run("Legal Rationale: ")
            lbl_j.font.bold = True
            lbl_j.font.size = Pt(9.5)
            lbl_j.font.color.rgb = RGBColor(71, 85, 105)
            run_j = j_p.add_run(justification)
            run_j.font.size = Pt(9.5)
            run_j.font.color.rgb = RGBColor(71, 85, 105)

        # Divider line
        p_line = doc.add_paragraph()
        p_line.paragraph_format.space_after = Pt(8)
        r_line = p_line.add_run("—" * 48)
        r_line.font.color.rgb = RGBColor(226, 232, 240)

    doc.save(output_path)
    return output_path


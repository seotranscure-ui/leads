HOW TO ADD PER-SPECIALTY SHEETS TO YOUR MASTER XLSX
=====================================================

WHAT HAPPENED:
Cowork's Linux sandbox crashed mid-session on my side (VHDX virtual-disk file
missing from the local Claude install). I cannot run Python from inside Cowork
right now, but I prepared the script so you can run it yourself in under a minute.
It will add 27 new sheets (one per priority specialty) to the existing XLSX.

WHAT WILL BE ADDED:
For each priority specialty (12 P1 + 15 P2 = 27 sheets), one new sheet that
contains every topic relevant to that specialty:
  - Canonical service page (national)
  - All Tier-1 state pages
  - All city pages
  - Specialty informational hub
  - CPT cheat sheet
  - Modifiers guide
  - Mistakes
  - KPIs
  - Common denials
  - Prior authorization guide
  - Credentialing guide
  - Audit guide
  - RCM guide
  - Medicare guide
  - Inhouse vs outsource comparison
  - Best billing companies listicle
  - Every individual CPT code commonly billed in that specialty (cross-referenced)
  - Every ICD-10 condition page attached to that specialty (cross-referenced)

Each new sheet uses the SAME 22 columns as the master sheet, so all titles,
meta descriptions, internal-link plans, image plans, etc. stay consistent.


HOW TO RUN (Windows, one click):
1. Double-click `run_add_specialty_sheets.bat`.
   It will check Python, install openpyxl if missing, and run the script.

HOW TO RUN (manual):
1. Open Command Prompt or PowerShell.
2. cd D:\Danish\Claude\Projects\Transcure
3. pip install openpyxl
4. python add_specialty_sheets.py

EXPECTED OUTPUT:
The script will print one line per specialty sheet showing how many topics
went into it (typically 40-75 topics per P1 specialty, 5-15 per P2 specialty),
then save the updated XLSX in place.

PREREQUISITES:
- Python 3.8 or newer (Microsoft Store, python.org, or any distribution)
- openpyxl (installed automatically by the .bat file, or `pip install openpyxl`)

WHAT THE SCRIPT WILL NOT DO:
- It will not modify any of the existing 4 sheets (Master, Apex, Action Plan, What NOT To Do).
- It will not delete or alter any existing data.
- If you re-run it, it will overwrite any specialty sheets it added previously
  (so re-runs are safe).

CAN I JUST DO IT FOR YOU NEXT SESSION?
Yes. Once Cowork's sandbox is back (usually a reload of the Claude app fixes the
VHDX issue), ask me to "add the specialty sheets" again and I'll execute it
end-to-end without you needing to touch Python.

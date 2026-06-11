# Documento Tecnico

## Scopo
Questo iFlow trasferisce dati di pricing da SAP verso Cegid, con un ramo manuale HTTPS per test e un ramo JMS per l’esecuzione ordinaria.

## Artifact
- Nome: IF33_ListinoPrezzi_SAP_to_Cegid
- Versione: 1.0.8
- Vendor: IF33_ListinoPrezzi_SAP_to_Cegid

## Ingressi
- JMS sender inbound: CEGID_IF33
- HTTPS sender manuale: /cegid/if33/manual
- Schema sorgente: PricingRecordValidity.xsd

## Trasformazioni
- Mapping principale: MM_PRCGCOND_PRCLIST
- Conversione XML -> CSV con separatore `;`
- Normalizzazione importi con `addZeroToNumber.groovy`
- Header e logging arricchiti nel ramo `execute`

## Output
- File CSV con naming `in/07_Listini_yyyyMMdd_HHmmss000.csv`
- Destinazione tecnica interna: ProcessDirect `/writefiles`

## Provenance
- file-extracted
- Confidence: 0.95
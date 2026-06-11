# Documento Funzionale

## Obiettivo business
Il flusso prepara e consegna i listini prezzi SAP nel formato atteso da Cegid, mantenendo un canale manuale per verifiche operative.

## Ingressi funzionali
- Dati pricing da SAP S/4
- Trigger manuale HTTPS per test e supporto

## Comportamento
- Il flusso valida se il payload è presente
- Se il payload è valido, esegue il mapping verso il formato target
- Se il payload è vuoto, evita l’invio e marca lo stato operativo come `NOT_SENT`

## Output funzionale
- CSV per Cegid con colonne `PREFIX;CODETYPE;CODEPERIODE;CODEBARRE;GF_PRIXUNITARIE`
- Flusso predisposto per produzione e tracciamento tecnico

## Note
- Le variabili runtime e i parametri tecnici sono mascherati nei documenti di handover se sensibili.
# Documento Handover / Onboarding

## Checklist iniziale
- Aprire l’iFlow e verificare i due ingressi: JMS e HTTPS manuale
- Controllare il mapping `MM_PRCGCOND_PRCLIST`
- Verificare lo script `addZeroToNumber.groovy`
- Confermare il receiver interno `ProcessDirect /writefiles`

## Cosa testare subito
- Un payload valido con riga CSV generata correttamente
- Un payload vuoto per verificare il ramo di controllo
- La formattazione dell’importo e il padding a 13 caratteri

## Punti da conoscere
- Il flusso non chiude il receiver esterno: delega la scrittura a un endpoint interno
- I parametri di ambiente devono essere raccolti dai file `.prop` e `.propdef`
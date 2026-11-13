# App Store — metadados do app CoreLog

> Preencha no App Store Connect. Ajuste URLs, contatos e capturas.

## Informações do app (pt-BR)

- **Nome** (até 30): `CoreLog — Frota`
- **Subtítulo** (até 30): `Rastreamento e pânico`
- **Texto promocional** (até 170): `Acompanhe veículos em tempo real, receba alertas de pânico e envie comandos remotos — mesmo com o app fechado.`
- **Categoria primária**: Navegação (ou Business)
- **Categoria secundária**: Utilidades
- **Classificação etária**: 4+ (uso profissional)
- **Preço**: Grátis (contrato B2B)
- **Idioma principal**: Português (Brasil)
- **URL de suporte**: `[https://corelog.example.com/support]`
- **URL de marketing**: `[https://corelog.example.com]`
- **URL da política de privacidade**: `[https://corelog.example.com/privacy]`

### Descrição

```
CoreLog é o aplicativo de rastreamento de frota para motoristas e equipes de
campo. Mantenha o veículo conectado à central, receba alertas e responda a
emergências com poucos toques.

RECURSOS

• Rastreamento contínuo em segundo plano, otimizado para bateria.
• Buffer offline: as posições são guardadas no aparelho e enviadas quando a
  conexão volta.
• Botão de pânico com envio prioritário da última posição conhecida.
• Comandos remotos: frequência de envio, silêncio, reativação e posição
  imediata.
• Interface simples, com estado do rastreamento e fila de envio.

COMO FUNCIONA

O CoreLog é fornecido pela sua transportadora/empresa. Ao iniciar o
rastreamento, o app solicita permissão de localização — inclusive “Sempre” — para
continuar registrando o trajeto com o app fechado. Uma notificação visível
permanece enquanto o serviço está ativo, e você pode parar o rastreamento a
qualquer momento.

Privacidade: [https://corelog.example.com/privacy]
Suporte: [suporte@corelog.example.com]
```

### Palavras-chave (até 100, separadas por vírgula)

`rastreamento,frota,logística,telemetria,caminhão,pânico,motorista,gps,gestão`

## Informações do app (en-US)

- **Name**: `CoreLog — Fleet`
- **Subtitle**: `Tracking & panic alerts`
- **Promotional text**: `Track vehicles in real time, receive panic alerts and send remote commands — even when the app is closed.`
- **Keywords**: `fleet,tracking,logistics,telematics,truck,panic,driver,gps,dispatch`
- **Description**:

```
CoreLog is the fleet tracking app for drivers and field teams. Keep the vehicle
connected to the control center, receive alerts and respond to emergencies in a
few taps.

FEATURES
• Continuous background tracking, optimized for battery life.
• Offline buffer: positions are stored on the device and uploaded when the
  connection returns.
• Panic button with high-priority delivery of the last known position.
• Remote commands: reporting frequency, silence, reactivate and immediate
  position.
• Simple UI with tracking state and upload queue.

CoreLog is provided by your company/fleet operator. Background location is
required for continuous tracking while the app is closed; a visible indicator
is always shown and tracking can be stopped at any time.
```

## Capturas de tela

Obrigatórias (iPhone): 6,9" (opcional se usar 6,5"), 6,5" e 5,5".
Se o app suportar iPad, envie também 12,9" (ou 13").

Sugestão:
1. Mapa com veículos e status.
2. Rastreamento ativo + notificação/indicador.
3. Botão de pânico e confirmação.
4. Comandos remotos (frequência/silêncio).
5. Fila offline/sincronização.

## App Privacy (resumo)

| Tipo | Vinculado | Rastreamento | Finalidade |
|---|---|---|---|
| Localização precisa | Sim | Não | Funcionalidade |
| Localização aproximada | Sim | Não | Funcionalidade |
| Device ID | Não | Não | Funcionalidade + Analytics |
| Interação com o produto | Não | Não | Analytics |

O `PrivacyInfo.xcprivacy` do app já declara APIs de motivo obrigatório e esses
tipos. Mantenha as respostas do App Store Connect iguais ao arquivo.

## TestFlight — informações do beta

- **Beta App Description**: `Beta do CoreLog para validar rastreamento em segundo plano, pânico e comandos remotos.`
- **Feedback email**: `[beta@corelog.example.com]`
- **O que testar**:
  ```
  1. Iniciar/parar o rastreamento e conferir a notificação persistente.
  2. Bloquear a tela e confirmar o envio contínuo de posições.
  3. Acionar o pânico com e sem internet (fila offline).
  4. Receber comandos remotos SET_FREQUENCY/SILENCE/REACTIVATE/REQUEST_IMMEDIATE_POSITION.
  5. Reconectar a rede e verificar a drenagem do buffer.
  ```
- **Export Compliance**: `ITSAppUsesNonExemptEncryption=false` (já no Info.plist).
- **App Review Notes**: forneça credenciais de teste e explique que o app é B2B
  e que a localização em segundo plano é essencial ao rastreamento de frota.

## Build/versão

- `MARKETING_VERSION`: `1.0.0` (visível)
- `CURRENT_PROJECT_VERSION`: `1` (incrementa a cada upload)
- Ajuste em Xcode → target CoreLogMobile → General, ou via `agvtool`:
  ```bash
  cd mobile/ios
  agvtool new-marketing-version 1.0.0
  agvtool new-version -all 2
  ```

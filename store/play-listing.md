# Google Play — metadados do app CoreLog

> Copie e cole no Play Console. Ajuste números/URLs conforme o contrato.

## Ficha da loja (pt-BR)

- **Nome do app** (até 30): `CoreLog — Rastreamento de Frota`
- **Descrição curta** (até 80): `Rastreie sua frota em tempo real, com botão de pânico e comandos remotos.`
- **Categoria**: Mapas e navegação (ou Negócios)
- **Tags**: rastreamento de frota, logística, telemetria, segurança
- **E-mail de suporte**: `[suporte@corelog.example.com]`
- **Site**: `[https://corelog.example.com]`
- **Política de privacidade**: `[https://corelog.example.com/privacy]`

### Descrição completa

```
CoreLog é a plataforma de rastreamento e gestão de frotas para transportadoras,
operadores logísticos e equipes de campo.

Com o app CoreLog, o motorista mantém o veículo conectado à central mesmo com o
aplicativo fechado. A localização é coletada por um serviço nativo otimizado
para bateria, com buffer offline: se a rede cair, as posições ficam guardadas no
aparelho e são enviadas automaticamente quando a conexão volta.

PRINCIPAIS RECURSOS

• Rastreamento contínuo em segundo plano, com notificação visível e controle
  para iniciar/parar a qualquer momento.
• Botão de pânico: envia um alerta prioritário com a última posição conhecida,
  mesmo sem internet (fila local com reenvio).
• Comandos remotos da central: alterar frequência de envio, silenciar, reativar
  e solicitar posição imediata.
• Trabalho offline: as posições são armazenadas localmente e sincronizadas
  quando houver conexão.
• Baixo consumo: intervalos configuráveis e envio em lote.

PARA QUEM É

• Transportadoras e frotas próprias
• Operações de última milha e field service
• Gestores que precisam de visibilidade em tempo real e resposta rápida a
  emergências

IMPORTANTE

O CoreLog é um app profissional fornecido pela sua empresa/transportadora. O uso
do rastreamento depende de contrato e das permissões concedidas no aparelho. A
localização em segundo plano é essencial para o funcionamento do serviço e pode
ser desativada a qualquer momento nas configurações do sistema.

Privacidade: [https://corelog.example.com/privacy]
Suporte: [suporte@corelog.example.com]
```

## Ficha da loja (en-US)

- **App name**: `CoreLog — Fleet Tracking`
- **Short description**: `Track your fleet in real time with panic alerts and remote commands.`
- **Full description**:

```
CoreLog is a fleet tracking and operations app for transport companies, logistics
operators and field teams.

The app keeps the vehicle connected to the control center even when closed.
Location is collected by a battery-conscious native service with an offline
buffer: if connectivity drops, positions are stored on the device and uploaded
automatically when the network returns.

KEY FEATURES
• Continuous background tracking with a visible notification and start/stop controls.
• Panic button: sends a high-priority alert with the last known position, even
  offline (local queue with retry).
• Remote commands: change the reporting frequency, silence, reactivate and
  request an immediate position.
• Offline-first: positions are stored locally and synced when possible.
• Low battery impact: configurable intervals and batched uploads.

CoreLog is a professional app provided by your company/fleet operator. Background
location is essential to the service and can be disabled at any time in the
device settings.
```

## Release notes (modelo)

```
• Rastreamento em segundo plano mais estável.
• Correção do envio de posições após reconexão.
• Melhorias no alerta de pânico e nos comandos remotos.
• Ajustes de desempenho e consumo de bateria.
```

## Assets

| Asset | Especificação |
|---|---|
| Ícone | 512×512 PNG, 32-bit, sem transparência |
| Feature graphic | 1024×500 PNG/JPEG |
| Screenshots telefone | 2–8, mín. 320 px, máx. 3840 px, 16:9 ou 9:16 |
| Screenshots tablet | opcional (7"/10") |
| Vídeo | opcional, YouTube público/não listado |

Sugestão de screenshots: (1) dashboard com veículos no mapa, (2) tela de
tracking ativo com notificação, (3) botão de pânico, (4) comandos remotos,
(5) buffer offline/sincronização.

## Data safety (resumo)

- Localização precisa/aproximada: coletada, compartilhada com o operador da
  frota, finalidade de funcionalidade do app, vinculada ao usuário, criptografada
  em trânsito.
- Device IDs: coletado, não compartilhado, funcionalidade + analytics.
- App interactions/diagnostics: coletado, não compartilhado, analytics.
- Sem venda de dados; sem fins publicitários.
- Exclusão de dados: `[URL/instrução]`.

## Declaração de permissão sensível (background location)

Texto sugerido:

```
O CoreLog é um aplicativo de rastreamento de frota. A localização em segundo
plano é a funcionalidade central: permite registrar o trajeto do veículo com o
app fechado ou a tela bloqueada. O usuário vê uma notificação persistente
enquanto o rastreamento está ativo e pode interrompê-lo pelo botão "Parar
rastreamento" ou pelas configurações do Android. Os dados são enviados apenas
para a central da transportadora contratante.
```

Anexe um vídeo curto mostrando: pedido de permissão “Permitir o tempo todo”,
notificação persistente, botão de parar e política de privacidade.

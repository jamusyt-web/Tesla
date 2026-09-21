// tesla_injector.ino — spoof-slave: answer frame 0x26 to move volume.
// ESP32 DevKit V1 (WROOM). UART2, RX2=GPIO16, TX2=GPIO17 (to NPN base).
// The real wheel switch module must be UNPLUGGED (we answer in its place).
#include <string.h>
#include "driver/uart.h"

#define LIN_BAUD     19200
#define LIN_UART_NUM 2
#define LIN_RX_PIN   16
#define LIN_TX_PIN   17
#define TARGET_PID   0xA6      // protected ID for frame 0x26
#define STEP_MS      10000     // 10 s between steps

static const uart_port_t PORT=(uart_port_t)LIN_UART_NUM;

// enhanced LIN checksum (includes PID)
static uint8_t enhChk(const uint8_t*d,int n,uint8_t pid){
  uint16_t s=pid; for(int i=0;i<n;i++){s+=d[i]; if(s>0xFF)s=(s&0xFF)+1;} return (uint8_t)(~s);
}

// 7-byte 0x26 responses (byte1 = scroll: 0x40 up, 0xC0 down, 0x00 idle)
static uint8_t fUp[7]   = {0x5E,0x40,0x10,0x08,0x5D,0x9A,0x00};
static uint8_t fDown[7] = {0x5E,0xC0,0x0F,0x08,0x5D,0x9A,0x00};
static uint8_t fIdle[7] = {0x5E,0x00,0x10,0x08,0x5D,0x9A,0x00};

static void respond(uint8_t*d){
  uint8_t crc=enhChk(d,7,TARGET_PID);
  uart_write_bytes(PORT,(const char*)d,7);
  uart_write_bytes(PORT,(const char*)&crc,1);
  uart_wait_tx_done(PORT, pdMS_TO_TICKS(10));
  uart_flush_input(PORT);         // discard our own echo
}
static int rb(uint32_t ms){uint8_t b;int n=uart_read_bytes(PORT,&b,1,pdMS_TO_TICKS(ms)+1);return n==1?b:-1;}

static uint32_t lastStep=0; static int pending=0, nextDir=1;

void setup(){
  Serial.begin(115200); delay(200);
  uart_config_t cfg={}; cfg.baud_rate=LIN_BAUD; cfg.data_bits=UART_DATA_8_BITS; cfg.parity=UART_PARITY_DISABLE;
  cfg.stop_bits=UART_STOP_BITS_1; cfg.flow_ctrl=UART_HW_FLOWCTRL_DISABLE; cfg.source_clk=UART_SCLK_APB;
  uart_driver_install(PORT,1024,256,0,NULL,0);
  uart_param_config(PORT,&cfg);
  uart_set_pin(PORT,LIN_TX_PIN,LIN_RX_PIN,UART_PIN_NO_CHANGE,UART_PIN_NO_CHANGE);
  uart_set_line_inverse(PORT,UART_SIGNAL_TXD_INV);   // NPN driver inverts TX
  lastStep=millis();
  Serial.println("INJECT 0x26 responder: 10s UP / 10s DOWN. (Wheel module must be unplugged.)");
}

void loop(){
  uint32_t now=millis();
  if(now-lastStep>=STEP_MS){
    lastStep=now; pending=nextDir; nextDir=(nextDir>0)?-1:1;
    Serial.printf("[queued %s]\n", pending>0?"UP":"DOWN");
  }
  int b=rb(30); if(b!=0x55) return;      // sync
  int pid=rb(3); if(pid!=TARGET_PID) return;
  uint8_t* f=fIdle;
  if(pending>0){f=fUp; pending=0; Serial.println(" -> UP frame sent");}
  else if(pending<0){f=fDown; pending=0; Serial.println(" -> DOWN frame sent");}
  respond(f);
}

// tesla_catalog.ino — list every LIN PID on the bus once, with data + checksum.
// Run twice: module PLUGGED IN, then UNPLUGGED. Frames that vanish are the
// module's -> those are the ones we must emulate.
#include <string.h>
#include "driver/uart.h"
#define LIN_BAUD 19200
#define LIN_UART_NUM 2
#define LIN_RX_PIN 16
#define LIN_TX_PIN 17
static const uart_port_t PORT=(uart_port_t)LIN_UART_NUM;
static QueueHandle_t uartQ;
static uint8_t chk(const uint8_t*d,int n,uint8_t pid,bool e){uint16_t s=e?pid:0;for(int i=0;i<n;i++){s+=d[i];if(s>0xFF)s=(s&0xFF)+1;}return (uint8_t)(~s);}
static uint8_t seen[64]={0};
static void handle(uint8_t*buf,int len){
  int idx=0; while(idx<len&&buf[idx]==0x00)idx++; if(idx<len&&buf[idx]==0x55)idx++;
  if(len-idx<2)return; uint8_t pid=buf[idx]; int id=pid&0x3F;
  uint8_t*d=&buf[idx+1]; int avail=len-idx-1;
  for(int k=1;k<=avail-1&&k<=8;k++){
    bool e=chk(d,k,pid,true)==d[k], c=chk(d,k,pid,false)==d[k];
    if(e||c){ if(!seen[id]){ seen[id]=1;
      Serial.printf("ID 0x%02X (PID 0x%02X) [%s] len=%d :",id,pid,e?"ENH":"CLA",k);
      for(int i=0;i<k;i++)Serial.printf(" %02X",d[i]); Serial.println(); }
      return; } }
}
static uint8_t frame[24]; static int flen=0;
void setup(){
  Serial.begin(115200); delay(200);
  uart_config_t cfg={}; cfg.baud_rate=LIN_BAUD; cfg.data_bits=UART_DATA_8_BITS; cfg.parity=UART_PARITY_DISABLE;
  cfg.stop_bits=UART_STOP_BITS_1; cfg.flow_ctrl=UART_HW_FLOWCTRL_DISABLE; cfg.source_clk=UART_SCLK_APB;
  uart_driver_install(PORT,2048,0,40,&uartQ,0); uart_param_config(PORT,&cfg);
  uart_set_pin(PORT,LIN_TX_PIN,LIN_RX_PIN,UART_PIN_NO_CHANGE,UART_PIN_NO_CHANGE);
  uart_set_line_inverse(PORT,UART_SIGNAL_TXD_INV);  // keep transistor OFF while listening
  Serial.println("CATALOG: each PID listed once.");
}
void loop(){
  uart_event_t ev;
  if(xQueueReceive(uartQ,&ev,pdMS_TO_TICKS(50))){
    if(ev.type==UART_DATA){uint8_t t[128];int r=uart_read_bytes(PORT,t,(ev.size<128?ev.size:128),0);for(int i=0;i<r;i++)if(flen<24)frame[flen++]=t[i];}
    else if(ev.type==UART_BREAK){if(flen>0){handle(frame,flen);flen=0;}}
    else{uart_flush_input(PORT);flen=0;}
  }
}

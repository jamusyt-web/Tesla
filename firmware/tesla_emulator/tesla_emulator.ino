// tesla_emulator.ino — full module emulation: answer BOTH 0x26 and 0x28.
// Module UNPLUGGED (we replace it). Transistor base wire (GPIO17) reconnected.
#include <string.h>
#include "driver/uart.h"
#define LIN_BAUD 19200
#define LIN_UART_NUM 2
#define LIN_RX_PIN 16
#define LIN_TX_PIN 17
#define PID_26 0xA6
#define PID_28 0xA8
#define STEP_MS 10000
static const uart_port_t PORT=(uart_port_t)LIN_UART_NUM;
static QueueHandle_t uartQ;
static uint8_t enh(const uint8_t*d,int n,uint8_t pid){uint16_t s=pid;for(int i=0;i<n;i++){s+=d[i];if(s>0xFF)s=(s&0xFF)+1;}return (uint8_t)(~s);}
static uint8_t f26[8];   // 7 data + crc; byte1 = scroll
static uint8_t f28[3];   // 00 00 + crc
static void build26(uint8_t b1,uint8_t b2){f26[0]=0x5E;f26[1]=b1;f26[2]=b2;f26[3]=0x08;f26[4]=0x5E;f26[5]=0x9A;f26[6]=0x00;f26[7]=enh(f26,7,PID_26);}
static uint32_t lastStep=0,holdUntil=0; static int nextDir=1; static uint8_t curB1=0x00; static bool prev55=false;
void setup(){
  Serial.begin(115200); delay(200);
  f28[0]=0x00; f28[1]=0x00; f28[2]=enh(f28,2,PID_28);
  build26(0x00,0x10);
  uart_config_t cfg={}; cfg.baud_rate=LIN_BAUD; cfg.data_bits=UART_DATA_8_BITS; cfg.parity=UART_PARITY_DISABLE;
  cfg.stop_bits=UART_STOP_BITS_1; cfg.flow_ctrl=UART_HW_FLOWCTRL_DISABLE; cfg.source_clk=UART_SCLK_APB;
  uart_driver_install(PORT,512,512,20,&uartQ,0); uart_param_config(PORT,&cfg);
  uart_set_pin(PORT,LIN_TX_PIN,LIN_RX_PIN,UART_PIN_NO_CHANGE,UART_PIN_NO_CHANGE);
  uart_set_line_inverse(PORT,UART_SIGNAL_TXD_INV);
  lastStep=millis();
  Serial.println("EMU: answering 0x26 + 0x28. 10s up/down. Module unplugged.");
}
void loop(){
  uint32_t now=millis();
  if(now-lastStep>=STEP_MS){lastStep=now;curB1=(nextDir>0)?0x40:0xC0;uint8_t b2=(nextDir>0)?0x10:0x0F;holdUntil=now+300;nextDir=(nextDir>0)?-1:1;build26(curB1,b2);Serial.printf("[%s]\n",curB1==0x40?"UP":"DOWN");}
  if(now>holdUntil && curB1!=0x00){curB1=0x00;build26(0x00,0x10);}
  uart_event_t ev;
  if(xQueueReceive(uartQ,&ev,pdMS_TO_TICKS(20))){
    if(ev.type==UART_DATA){
      uint8_t t[64]; int r=uart_read_bytes(PORT,t,(ev.size<64?ev.size:64),0);
      for(int i=0;i<r;i++){
        if(prev55){ prev55=false;
          if(t[i]==PID_26) uart_write_bytes(PORT,(const char*)f26,8);
          else if(t[i]==PID_28) uart_write_bytes(PORT,(const char*)f28,3);
        } else if(t[i]==0x55) prev55=true;
      }
    } else prev55=false;
  }
}

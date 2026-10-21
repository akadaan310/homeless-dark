/* HOMELESS bounded QuickJS worker. No libc module or host imports are installed.
 * Linux syscall allowlist is defense in depth; this is not a formal engine audit. */
#define _GNU_SOURCE
#include "quickjs.h"
#include <errno.h>
#include <fcntl.h>
#include <linux/audit.h>
#include <linux/filter.h>
#include <linux/seccomp.h>
#include <stddef.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/resource.h>
#include <sys/socket.h>
#include <sys/syscall.h>
#include <time.h>
#include <unistd.h>

#if defined(__aarch64__)
#define EXPECTED_ARCH AUDIT_ARCH_AARCH64
#elif defined(__x86_64__)
#define EXPECTED_ARCH AUDIT_ARCH_X86_64
#else
#error Supported worker platforms are Linux ARM64 and x86_64
#endif

#define PERMIT(n) BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,(n),0,1), BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ALLOW)
static int restrict_syscalls(void) {
    struct sock_filter rules[]={
        BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,arch)),
        BPF_JUMP(BPF_JMP|BPF_JEQ|BPF_K,EXPECTED_ARCH,1,0),
        BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_KILL_PROCESS),
        BPF_STMT(BPF_LD|BPF_W|BPF_ABS,offsetof(struct seccomp_data,nr)),
        PERMIT(SYS_read), PERMIT(SYS_write), PERMIT(SYS_close),
        PERMIT(SYS_brk), PERMIT(SYS_mmap), PERMIT(SYS_munmap), PERMIT(SYS_mremap),
        PERMIT(SYS_mprotect), PERMIT(SYS_madvise), PERMIT(SYS_clock_gettime),
        PERMIT(SYS_rt_sigaction), PERMIT(SYS_rt_sigprocmask), PERMIT(SYS_rt_sigreturn),
        PERMIT(SYS_exit), PERMIT(SYS_exit_group), PERMIT(SYS_futex),
        BPF_STMT(BPF_RET|BPF_K,SECCOMP_RET_ERRNO|EPERM)
    };
    struct sock_fprog program={(unsigned short)(sizeof(rules)/sizeof(rules[0])),rules};
    return prctl(PR_SET_NO_NEW_PRIVS,1,0,0,0) || prctl(PR_SET_SECCOMP,SECCOMP_MODE_FILTER,&program);
}

static int limit_resource(int which, rlim_t amount) {
    struct rlimit limit={amount,amount}; return setrlimit(which,&limit);
}

static double monotonic_seconds(void) {
    struct timespec t;
    if(clock_gettime(CLOCK_MONOTONIC,&t)!=0) return 1e100;
    return (double)t.tv_sec+(double)t.tv_nsec/1e9;
}
typedef struct {double deadline; unsigned calls;} Interrupt;
static int interrupted(JSRuntime *runtime,void *opaque) {
    (void)runtime;
    Interrupt *state=opaque;
    return ++state->calls>10000 || monotonic_seconds()>state->deadline;
}
static int refuse(const char *reason) {
    char result[256];
    int n=snprintf(result,sizeof(result),"{\"status\":\"REFUSED\",\"code\":\"%s\"}\n",reason);
    if(n>0 && n<(int)sizeof(result)) (void)write(STDOUT_FILENO,result,(size_t)n);
    return 2;
}

int main(int argc,char **argv) {
    if(limit_resource(RLIMIT_AS,128*1024*1024)||limit_resource(RLIMIT_CPU,1)||
       limit_resource(RLIMIT_FSIZE,128*1024)||limit_resource(RLIMIT_NOFILE,3)||
       limit_resource(RLIMIT_CORE,0)) return refuse("OS_BUDGET_UNAVAILABLE");
    if(argc==2 && strcmp(argv[1],"--probe-syscalls")==0) {
        if(restrict_syscalls()) return refuse("FILTER_UNAVAILABLE");
        errno=0;int a=open("/dev/null",O_RDONLY);int a_blocked=a<0 && errno==EPERM;
        errno=0;int b=socket(AF_INET,SOCK_STREAM,0);int b_blocked=b<0 && errno==EPERM;
        char *const args[]={"/bin/true",NULL};char *const env[]={NULL};
        errno=0;int c=execve("/bin/true",args,env);int c_blocked=c<0 && errno==EPERM;
        const char *good="{\"open_blocked\":true,\"socket_blocked\":true,\"exec_blocked\":true}\n";
        if(a_blocked && b_blocked && c_blocked) {(void)write(1,good,strlen(good));return 0;}
        return refuse("FILTER_PROBE_FAILED");
    }
    if(argc!=1)return refuse("ARGUMENTS");
    char input[65538];size_t length=0;
    while(length<sizeof(input)-1) {
        ssize_t n=read(0,input+length,sizeof(input)-1-length);
        if(n==0)break;
        if(n<0)return refuse("INPUT_READ");
        length+=(size_t)n;
    }
    if(length==0 || length>65536)return refuse("INPUT_BUDGET");
    input[length]=0;
    JSRuntime *runtime=JS_NewRuntime();
    if(!runtime)return refuse("RUNTIME_MEMORY");
    JS_SetMemoryLimit(runtime,16*1024*1024);JS_SetMaxStackSize(runtime,256*1024);
    JSContext *context=JS_NewContext(runtime);
    if(!context){JS_FreeRuntime(runtime);return refuse("CONTEXT_MEMORY");}
    Interrupt budget={monotonic_seconds()+.15,0};JS_SetInterruptHandler(runtime,interrupted,&budget);
    const char *bootstrap="delete globalThis.Date;delete Math.random;Object.freeze(Math);";
    JSValue setup=JS_Eval(context,bootstrap,strlen(bootstrap),"<bootstrap>",JS_EVAL_TYPE_GLOBAL);
    JS_FreeValue(context,setup);
    if(restrict_syscalls()){JS_FreeContext(context);JS_FreeRuntime(runtime);return refuse("FILTER_UNAVAILABLE");}
    JSValue value=JS_Eval(context,input,length,"<contribution>",JS_EVAL_TYPE_GLOBAL);
    int result=0;
    if(JS_IsException(value))result=refuse("SCRIPT_EXCEPTION_OR_BUDGET");
    else {
        JSValue json=JS_JSONStringify(context,value,JS_UNDEFINED,JS_UNDEFINED);
        if(JS_IsException(json)||JS_IsUndefined(json))result=refuse("RESULT_ENCODING");
        else {
            size_t size=0;const char *text=JS_ToCStringLen(context,&size,json);
            if(!text||size>65536)result=refuse("OUTPUT_BUDGET");
            else {(void)write(1,text,size);(void)write(1,"\n",1);}
            if(text)JS_FreeCString(context,text);
        }
        JS_FreeValue(context,json);
    }
    JS_FreeValue(context,value);JS_FreeContext(context);JS_FreeRuntime(runtime);
    return result;
}

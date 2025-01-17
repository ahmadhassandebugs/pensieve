import sys
import os
import subprocess
import numpy as np

RUN_SCRIPT = 'run_video.py'
RANDOM_SEED = 42
RUN_TIME = 300  # sec
MM_DELAY = 40  # milli sec
HO_TRACE_DIR = 'handover_predict_traces' # 'ground-truth-mm-ho-traces'


def main():
    trace_path = sys.argv[1]
    abr_algo = sys.argv[2]
    process_id = sys.argv[3]
    ip = sys.argv[4]

    sleep_vec = range(1, 10)  # random sleep second

    files = os.listdir(trace_path)
    if files.__len__() == 0:
        print('no trace files found in specified directory')
        return

    for f in files: # files ['DCOV-ROSLOOP-TRACE-VZW_1_239']

        while True:

            np.random.shuffle(sleep_vec)
            sleep_time = sleep_vec[int(process_id)]

            # command = 'mm-delay ' + str(MM_DELAY) + ' mm-link 12mbps ' + trace_path + f + ' --meter-downlink ' + \
            #           '/usr/bin/python ' + RUN_SCRIPT + ' ' + ip + ' ' + abr_algo + ' ' + \
            #           str(RUN_TIME) + ' ' + process_id + ' ' + f + ' ' + str(sleep_time)

            command = 'mm-delay ' + str(MM_DELAY) + ' mm-link 12mbps ' + trace_path + f + ' ' + \
                      '/usr/bin/python ' + RUN_SCRIPT + ' ' + ip + ' ' + abr_algo + ' ' + \
                      str(RUN_TIME) + ' ' + process_id + ' ' + f + ' ' + str(sleep_time) + ' ' \
                      + '../'+ HO_TRACE_DIR + '/'+f+'.csv'
            
            print command


            proc = subprocess.Popen(command,
                                    stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                    shell=True) 


            (out, err) = proc.communicate()
            print out

            # if out == 'done\n':
            #     break
            # else:
            #     with open('./chrome_retry_log', 'ab') as log:
            #         log.write(abr_algo + '_' + f + '\n')
            #         log.write(out + '\n')
            #         log.flush()
            if 'timeout' in out:
                with open('./chrome_retry_log', 'ab') as log:
                    log.write(abr_algo + '_' + f + '\n')
                    log.write(out + '\n')
                    log.flush()      
            else:
                break


if __name__ == '__main__':
    main()

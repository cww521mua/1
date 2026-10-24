export {};

/** CPU 时间采样（纳秒累计值）。 */
export interface CpuSample {
    idle: number;
    total: number;
    at: number;
}

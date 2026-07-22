
 WITH a AS
(
  SELECT DISTINCT
         hh.SITE_CODE,
         RIGHT(hh.fiscal_year,2) || 'WW' || LPAD(hh.fiscal_week,2,'0') AS fiscal_week,
         hh.TRANSACTION_DATE_TIME,
         hh.LOAD_TIMESTAMP,
         DATE(hh.TRANSACTION_DATE_TIME - CAST('7 hr' AS INTERVAL)) AS wd_date,
         hh.container_id,
         hh.lot_type,
         hh.transaction_name,
         hh.proc_code,
         hh.operation_id,
         hh.to_operation_id,
         hh.operation_description,
         hh.to_operation_description,
         hh.reversal_status,
         hh.quantity_througput AS OUTPUT,
         hh.quantity_change*-1 AS defect,
         ha.slidercompcontainer AS jobnumber,
         ha.suspensioncompcontainer AS suspensionnumber,
         ha.hgst_18charlotnumber AS lotnumber,
         ha.hgst_numberoftrays AS trayqty,
         ha.hgst_pen AS pen,
         co.lot_detail_batch_id AS batch_id,
         co.engineering_change_fab AS LEC,
         co.wafer_id,
         hh.part_number,
         hh.head_type AS model,
         CASE
           WHEN hh.head_type_flag = 'D' THEN 'DN'
           WHEN hh.head_type_flag = 'U' THEN 'UP'
           ELSE hh.head_type_flag
         END AS headtype,
         hh.experiment_id,
         hh.class_description AS classname,
         hh.hold_reason,
         hh.comments,
         hh.operator_id,
         hh.operator_name
  FROM AH.HIS_HGA_LOT AS hh
    LEFT JOIN ah.dim_hgst_hga_attributes ha ON ha.hgst_hgaattributesname = hh.container_id
    LEFT JOIN ah.dim_container co ON co.container_name = hh.container_id
  WHERE 1 = 1
  AND   hh.lot_type IN ('HGA','SUSPENSION','SLIDER')
  AND   hh.transaction_date_time > '2026-01-01 07:00:00'
  AND   hh.container_id <> ''
  AND   hh.operation_id IN (2207)
)
SELECT lotnumber,
       COUNT(*) AS row_count,
       COUNT(DISTINCT transaction_date_time) AS distinct_txn_times,
       COUNT(DISTINCT operation_id) AS distinct_ops,
       COUNT(DISTINCT operator_name) AS distinct_operators,
       COUNT(DISTINCT batch_id) AS distinct_batches
FROM a
GROUP BY lotnumber
HAVING COUNT(*) > 1;
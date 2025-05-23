/** 
 * @NApiVersion 2.1
 * @NModuleScope Public 

 */
 define(['N/search','N/error', 'N/record', 'N/task', 'N/runtime', './bit_mx_loc_lib'], function (search,error,record,task, runtime, lib_mx_loc) {

    //const DEPLOYMENTS_LIMIT = 20;
    var deployCount = 0;

    /**
     * 
     * Crea y envia una tarea, y retorna el Id de la instancia.
     * @governance 20 units (Si Requiere crear Deploy 45 units)
     *
     * @restriction Únicamente para usar en Server SuiteScript
     * @param  {Object} taskOptions
     * @param  {String} taskOptions.taskType task.TaskType.SCHEDULED_SCRIPT | task.TaskType.MAP_REDUCE
     * @param  {String} taskOptions.scriptId ID del script
     * @param  {Object} [taskOptions.params] un parámetro de script creado previamente debe establecerse. Ejemplo: {'custscript_index' : 200}
     * @return {String} TaskID
     * 
     */

    function runTask(taskOptions) {
        var taskId;
        if (taskOptions.hasOwnProperty('deploymentId')){
            delete taskOptions.deploymentId
        }

        try {
            taskObj = task.create(taskOptions)
            taskId = taskObj.submit();
            return taskId;
        } catch (e) { 
            /*Si el error ocurre porque no exite implementacion Disponible.*/
            if (e.name === "NO_DEPLOYMENTS_AVAILABLE") {
                return cloneDeploy(taskOptions)
            }else{
                throw error.create(e);
            }
        }

    }

    /**
     * 
     * Evento auxiliar para el metodo runTask 
     * Clona Deployments en caso de no encontrar disponibles
     * @governance 25 units
     *
     * @restriction Únicamente para usar como Evento Auxiliar
     * @param  {Object} taskOptions
     * @param  {String} taskOptions.taskType task.TaskType.SCHEDULED_SCRIPT | task.TaskType.MAP_REDUCE
     * @param  {String} taskOptions.scriptId ID del script
     * @param  {Object} [taskOptions.params] un parámetro de script creado previamente debe establecerse. Ejemplo: {'custscript_index' : 200}
     * @return {String} TaskID
     * 
     */
    function cloneDeploy(taskOptions) {

        deploymentId = searchOneDeployXClone(taskOptions)
        scriptCustId = "_bit_mx_loc_mr_" + deployCount;

        var objRecord = record.copy({
            type: record.Type.SCRIPT_DEPLOYMENT,
            id: deploymentId,
            isDynamic: true
        });

        objRecord.setValue({
            fieldId: 'scriptid',
            value: scriptCustId,
            ignoreFieldChange: true
        });

        objRecord.save({
            enableSourcing: true,
            ignoreMandatoryFields: true
        });

        return runTask(taskOptions)
    }

    /**
     * 
     * Evento auxiliar para el metodo cloneDeploy. 
     * Recuperar el internal ID de un deploy para Clonarlo.
     * @governance 10 units
     *
     * @restriction Únicamente para usar como evento Auxiliar
     * @param  {Object} taskOptions
     * @param  {String} taskOptions.scriptId ID del script Ejemplo: customscript_ss_qbt_test
     * @param  {String} [taskOptions.deployLimit] Limite de implementaciones a Crear
     * @return {Integer} Internal ID del primer deploy encontrado
     *
     */
    function searchOneDeployXClone(taskOptions) {
        /*var userSubsidiary = runtime.getCurrentUser().subsidiary;
        var objConfigSub = lib_mx_loc.getSubsidiaryConfig(userSubsidiary);  
        var deployLimit = objConfigSub && objConfigSub.deployLimit ? objConfigSub.deployLimit : DEPLOYMENTS_LIMIT*/

        var scriptSearchObj = search.create({
            type: search.Type.SCRIPT_DEPLOYMENT,
            filters: [["script.scriptid","is",taskOptions.scriptId]],
            columns: ["scriptid"]
         });
         searchResultCount = scriptSearchObj.runPaged().count;
         deployCount = searchResultCount + 1;
         /*if (searchResultCount >= deployLimit) {
            throw error.create({
                name: 'LIMIT_CREATE_DEPLOY',
                message: 'No se puede crear la implementación, se alcanzó el límite.',
                notifyOff: false
            });
         }*/

        var results = scriptSearchObj.run().getRange({
            start: 0,
            end: 1
        });

        if (results.length) {
            return results[0].id
        }

        throw error.create({
            name: 'FAILED_CREATE_DEPLOY',
            message: 'Se produjo un error al enviar la solicitud de trabajo: no se encontraron implementaciones disponibles.',
            notifyOff: false
        });
    }

 return {
        runTask: runTask
    }
});

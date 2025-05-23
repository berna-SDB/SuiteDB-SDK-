/**
 * @NApiVersion 2.1
 * @NModuleScope Public
 * 
 * Task          Date            Author                                                     Remarks
 * BSMX-70       07 Jan 2022     Tim Araque <tim.araque@bringitps.com>                      [Sprint/37] start
 * BMS-575		 02 Aug 2023     Ana Hermosillo <ana.hermosillo@bringitps.com>              [SPRINT/69] Remove double spaces in the company name.
 *
 */
define(['N/log', 'N/error', 'N/runtime', 'N/search', 'N/file', 'N/record', 'N/redirect', 'N/config', 'N/render', 'N/format', 'N/email', 'N/url'],
function(log, error, runtime, search, file, record, redirect, config, render, format, email, url) {
    
//Actualiza el campo companyname de un cliente en NetSuite cuando el tipo de cliente es una persona física. Concatena el nombre, segundo nombre y apellido
function concatNameCustomerInCompanyNameField(context){
    try{

        log.debug('ISPERSON customer type', context.newRecord.getValue('isperson'));

        if(context.newRecord.getValue('isperson') == 'T') {

            let newFirstName = context.newRecord.getValue('firstname');

            let newMiddleName = context.newRecord.getValue('middlename');

            let newLastName = context.newRecord.getValue('lastname');

            let oldFirstName = context?.oldRecord?.getValue('firstname');

            let oldMiddleName = context?.oldRecord?.getValue('middlename');

            let oldLastName = context?.oldRecord?.getValue('lastname');

            if(newFirstName != oldFirstName || newMiddleName != oldMiddleName || newLastName != oldLastName){

                //let companyName = newFirstName+' '+newMiddleName+' '+newLastName; //BMS-575.o
                let companyName = (newFirstName+' '+newMiddleName+' '+newLastName).replace(/\s+/gi,' '); //BMS-575.n

                context.newRecord.setValue('companyname', companyName);

                log.debug('update Company Name for ISPERSON customer type ', companyName);
            }
        }
    } catch (e) {

        let customError = error.create({
            name: 'CONCAT_ALL_FIELDS_NAME_ERROR',
            message: e.message || JSON.stringify(e),
            notifyOff: true
        });

        log.error("CONCAT_ALL_FIELDS_NAME_ERROR", JSON.stringify(e));

        throw customError;
    }
}

return {
    concatNameCustomerInCompanyNameField,
};
});

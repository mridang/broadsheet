describe('Application Health Check', () => {
  it('should successfully load the homepage', () => {
    cy.request('http://localhost:3000/').then((response) => {
      expect(response.status).to.eq(200);
    });
  });
});

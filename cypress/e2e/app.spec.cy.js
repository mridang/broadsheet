describe('The Hacker Times homepage', () => {
  it('loads with a 200 and renders the masthead', () => {
    cy.request('http://localhost:3737/').then((response) => {
      expect(response.status).to.eq(200);
      expect(response.body).to.contain('The Hacker Times');
    });
  });
});
